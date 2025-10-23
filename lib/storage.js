import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const localBase = path.join(process.cwd(), 'data', 'stems');

// Read stem by cache key
export async function readStemByKey(key) {
  const localPath = path.join(localBase, key + '.wav');
  
  // Check local first
  if (fs.existsSync(localPath)) {
    return { path: localPath };
  }
  
  // Try Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase.storage
        .from('stems')
        .download(key + '.wav');
      
      if (error || !data) return null;
      
      const buffer = Buffer.from(await data.arrayBuffer());
      fs.mkdirSync(localBase, { recursive: true });
      fs.writeFileSync(localPath, buffer);
      
      return { path: localPath };
    } catch (err) {
      console.error('Supabase download error:', err);
      return null;
    }
  }
  
  return null;
}

// Write stem to storage
export async function writeStem(project_id, scene_id, line_id, wavBuffer, key) {
  const filename = key || `${project_id}_${scene_id}_${line_id}`;
  const localPath = path.join(localBase, filename + '.wav');
  
  // Write locally
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, wavBuffer);
  
  // Upload to Supabase if available
  if (supabase) {
    try {
      await supabase.storage
        .from('stems')
        .upload(filename + '.wav', wavBuffer, {
          contentType: 'audio/wav',
          upsert: true
        });
    } catch (err) {
      console.error('Supabase upload error:', err);
    }
  }
  
  return localPath;
}