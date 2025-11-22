// workers/tts.js
import pLimit from 'p-limit';
import { ttsKey, hash } from '../lib/idempotency.js';
import { getVoiceForCharacter, upsertVoiceMap } from '../lib/db.js';
import { readStemByKey, writeStem } from '../lib/storage.js';
import { ttsGenerate } from '../lib/audio.js';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const sb = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

export async function ttsForScene(project_id, scene) {
  const limit = pLimit(3);

  console.log(`\n🔍 DIAGNOSTIC: Processing ${scene.dialogue.length} dialogue lines for scene ${scene.scene_id}`);

  return Promise.all(
    scene.dialogue.map(line => limit(async () => {
      console.log(`\n📝 DIAGNOSTIC Line ${line.line_id}:`, {
        character: line.character,
        text_preview: line.text.substring(0, 50),
        has_voice_field: !!line.voice,
        voice_value: line.voice || 'MISSING',
        has_voice_id_field: !!line.voice_key,
        voice_id_value: line.voice_key || 'MISSING'
      });

      const voice = line.voice_key
        ? { voice_id: line.voice_key, params_json: {} }
        : (await getVoiceForCharacter(project_id, line.character)
           || await upsertVoiceMap(project_id, line.character));

      console.log(`✅ DIAGNOSTIC: Using voice_id="${voice.voice_id}" for character="${line.character}"`);

      const key = ttsKey(
        project_id,
        scene.scene_id,
        line.line_id,
        voice.voice_id,
        voice.params_json,
        line.text
      );

      const cached = await readStemByKey(key);
      if (cached) {
        console.log(`♻️  DIAGNOSTIC: Using cached TTS for line ${line.line_id}`);
        return { line_id: line.line_id, path: cached.path };
      }

      console.log(`🎙️  DIAGNOSTIC: Generating NEW TTS with ElevenLabs voice_id="${voice.voice_id}"`);
      const wav = await ttsGenerate({ voice, text: line.text });
      const stemPath = await writeStem(project_id, scene.scene_id, line.line_id, wav, key);

      if (sb) {
        const textHash = hash(line.text);
        const voiceHash = hash(voice.voice_id + JSON.stringify(voice.params_json));

        await sb.from('tts_stems').upsert({
          project_id,
          scene_id: scene.scene_id,
          line_id: line.line_id,
          text_hash: textHash,
          voice_hash: voiceHash,
          path: stemPath,
          duration_s: null
        }, {
          onConflict: 'project_id,scene_id,line_id'
        });
      }

      return { line_id: line.line_id, path: stemPath };
    }))
  );
}
