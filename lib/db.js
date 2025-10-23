import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const localPath = path.join(process.cwd(), 'data', 'voice_map.json');

// Read local voice map
function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  } catch {
    return {};
  }
}

// Write local voice map
function writeLocal(obj) {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, JSON.stringify(obj, null, 2));
}

// Get voice for character
export async function getVoiceForCharacter(project_id, character) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('voice_map')
        .select('*')
        .eq('project_id', project_id)
        .eq('character', character)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('DB error:', err);
    }
  }
  
  // Fallback to local
  const map = readLocal();
  return map[`${project_id}:${character}`] || null;
}

// Upsert voice map
export async function upsertVoiceMap(project_id, character) {
  const row = {
    project_id,
    character,
    voice_id: '21m00Tcm4TlvDq8ikWAM', // Default ElevenLabs voice
    provider: 'elevenlabs',
    params_json: { 
      stability: 0.4, 
      similarity_boost: 0.7 
    }
  };
  
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('voice_map')
        .upsert(row)
        .select('*')
        .maybeSingle();
      
      if (error) throw error;
      return data || row;
    } catch (err) {
      console.error('DB upsert error:', err);
    }
  }
  
  // Fallback to local
  const map = readLocal();
  map[`${project_id}:${character}`] = row;
  writeLocal(map);
  return row;
}