// workers/align.js - UPDATED WITH WHISPER INTEGRATION
import { audioDurationSec } from '../lib/audio.js';
import { whisperAlign, mapWordsToText } from './whisper-align.js';
import { createClient } from '@supabase/supabase-js';

const sb = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

/**
 * Context-aware gap computation
 * Adjusts gaps based on punctuation, character changes, and intensity
 */
const strong = (s) => /[.!?]"?$/.test(s.trim());
const comma = (s) => /[,:;]"?$/.test(s.trim());

export function computeGap(current, next, intensity = 0.5) {
  let base = 0.30;
  
  if (strong(current.text)) base = 0.60;
  else if (comma(current.text)) base = 0.40;
  
  if (next && current.character !== next.character) base += 0.40;
  
  base *= (1.2 - (intensity || 0.5) * 0.4);
  
  return Math.max(0.15, Math.min(1.50, base));
}

/**
 * Align scene dialogue with context-aware pacing
 * Uses Whisper ASR if available, falls back to duration-based
 * 
 * @param {string} project_id - Project ID
 * @param {Object} scene - Scene object with dialogue
 * @param {Array} stems - Array of {line_id, path} dialogue stems
 * @param {Object} providerAlignment - Optional provider-supplied alignment
 * @returns {Object} Alignment object with lines and words
 */
export async function alignScene(project_id, scene, stems, providerAlignment) {
  // If provider already gave us alignment, use it
  if (providerAlignment?.lines?.length) {
    const lines = providerAlignment.lines.slice().sort((a, b) => a.start - b.start);
    
    // Save to database
    await saveAlignment(project_id, scene.scene_id, { scene_id: scene.scene_id, lines });
    
    return { scene_id: scene.scene_id, lines };
  }
  
  const lines = [];
  let cursor = 0;
  
  for (let i = 0; i < scene.dialogue.length; i++) {
    const curr = scene.dialogue[i];
    const next = scene.dialogue[i + 1];
    const stem = stems.find(s => s.line_id === curr.line_id);
    
    if (!stem) throw new Error(`Missing stem for line ${curr.line_id}`);
    
    const dur = await audioDurationSec(stem.path);
    const start = cursor;
    const end = start + dur;
    
    // Try to get word-level timestamps from Whisper
    let words = null;
    try {
      const whisperWords = await whisperAlign(stem.path, curr.text);
      if (whisperWords && whisperWords.length > 0) {
        // Offset word timestamps by line start time
        words = whisperWords.map(w => ({
          w: w.word,
          s: start + w.start,
          e: start + w.end
        }));
      }
    } catch (err) {
      console.warn(`   ⚠️  Whisper alignment failed for line ${curr.line_id}, using duration fallback`);
    }
    
    lines.push({
      line_id: curr.line_id,
      start,
      end,
      ...(words && { words })
    });
    
    cursor = end + computeGap(curr, next, scene.intensity ?? 0.5);
  }
  
  const alignment = { scene_id: scene.scene_id, lines };
  
  // Save to database
  await saveAlignment(project_id, scene.scene_id, alignment);
  
  return alignment;
}

/**
 * Save alignment to database
 */
async function saveAlignment(project_id, scene_id, alignment) {
  if (sb) {
    await sb.from('alignments').upsert({
      project_id,
      scene_id,
      alignment_json: alignment,
      created_at: new Date().toISOString()
    });
  }
}