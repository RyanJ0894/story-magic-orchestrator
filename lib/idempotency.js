// lib/idempotency.js
import crypto from 'crypto';

export const hash = (s) => 
  crypto.createHash('sha256').update(s).digest('hex');

export function ttsKey(project_id, scene_id, line_id, voice_id, params, text) {
  const vhash = hash(voice_id + JSON.stringify(params));
  const thash = hash(text);
  // Use underscores instead of colons for Windows compatibility
  return `${project_id}_${scene_id}_${line_id}_${vhash}_${thash}`;
}

export function ttskey(project_id, scene_id, line_id, voice_id, params, text) {
  return ttsKey(project_id, scene_id, line_id, voice_id, params, text);
}