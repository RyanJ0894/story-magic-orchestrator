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

/**
 * Generate TTS for all dialogue lines in a scene
 * Uses caching and rate limiting (3 concurrent max)
 * 
 * @param {string} project_id - Project UUID
 * @param {Object} scene - Scene with dialogue array
 * @returns {Promise<Array>} Array of {line_id, path} stems
 */
export async function ttsForScene(project_id, scene) {
  const limit = pLimit(3); // Max 3 concurrent TTS calls

  return Promise.all(
    scene.dialogue.map(line => limit(async () => {
      // Get or create voice mapping for character
      const voice = await getVoiceForCharacter(project_id, line.character)
        || await upsertVoiceMap(project_id, line.character);

      // Generate idempotency key
      const key = ttsKey(
        project_id,
        scene.scene_id,
        line.line_id,
        voice.voice_id,
        voice.params_json,
        line.text
      );

      // Check cache
      const cached = await readStemByKey(key);
      if (cached) {
        return { line_id: line.line_id, path: cached.path };
      }

      // Generate new TTS
      const wav = await ttsGenerate({ voice, text: line.text });
      const stemPath = await writeStem(project_id, scene.scene_id, line.line_id, wav, key);

      // Store metadata in Supabase (if available)
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
          duration_s: null // Will be calculated later if needed
        }, {
          onConflict: 'project_id,scene_id,line_id'
        });
      }

      return { line_id: line.line_id, path: stemPath };
    }))
  );
}