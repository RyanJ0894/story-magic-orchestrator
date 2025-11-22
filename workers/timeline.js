// workers/timeline.js - UPDATED WITH VALIDATION
import { validateTimeline, autoFixTimeline } from './timeline-validator.js';
import { createClient } from '@supabase/supabase-js';

const sb = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

/**
 * Build scene timeline from alignment and cue choices
 * Validates for overlaps and conflicts
 * 
 * @param {Object} scene - Scene object
 * @param {Object} alignment - Alignment with line timings
 * @param {Object} cueChoices - Selected music and ambience cues
 * @returns {Object} Timeline with events
 */
export async function buildTimeline(scene, alignment, cueChoices) {
  const events = [];
  // Add dialogue events
  for (const line of alignment.lines) {
    events.push({
      type: 'dialogue_in',
      line_id: line.line_id,
      at: line.start
    });
    
    events.push({
      type: 'dialogue_out',
      line_id: line.line_id,
      at: line.end
    });
  }
  
  // Add ambience events
  if (cueChoices.ambience?.[0]) {
    const cue = cueChoices.ambience[0];
    
    events.push({
      type: 'ambience_in',
      cue_id: cue.track_id,
      at: 0,
      fade: cue.fade_in || 1.5,
      gain_db: cue.volume || -18
    });
    
    const end = alignment.lines.at(-1)?.end ?? 60;
    events.push({
      type: 'ambience_out',
      cue_id: cue.track_id,
      at: Math.max(0, end - 1.5),
      fade: cue.fade_out || 1.5
    });
  }
  
  // Add music events
  if (cueChoices.music?.[0]) {
    const cue = cueChoices.music[0];
    const first = alignment.lines[0]?.start ?? 2;
    const last_index = alignment.lines ? alignment.lines.length -1 : 0;
    const last = alignment.lines[last_index]?.end ?? 2;

    
    events.push({
      type: 'music_in',
      cue_id: cue.track_id,
      at: Math.max(0, first + 2),
      fade: cue.fade_in || 1.5,
      gain_db: cue.volume || -12,
      duck_db: 7  // Ducking amount during dialogue
    });
    
    const end = alignment.lines.at(-1)?.end ?? 60;
    events.push({
      type: 'music_out',
      cue_id: cue.track_id,
      at: Math.max(0, last +2),
      fade: cue.fade_out || 1.5
    });
  }
  
  // Add SFX events if present in scene
  if (scene.sfx) {
    for (const sfx of scene.sfx) {
      events.push({
        type: 'sfx_at',
        cue_id: sfx.track_id,
        at: sfx.at,
        gain_db: sfx.volume ?? -6
      });
    }
  }
  
  const timeline = {
    scene_id: scene.scene_id,
    events: events.sort((a, b) => a.at - b.at)
  };
  
  // Validate timeline
  const validation = validateTimeline(timeline);
  
  if (!validation.valid) {
    console.error(`   ❌ Timeline validation failed for scene ${scene.scene_id}:`);
    for (const error of validation.errors) {
      console.error(`      • ${error}`);
    }
    
    console.log(`   🔧 Attempting auto-fix...`);
    const fixed = autoFixTimeline(timeline);
    
    const revalidation = validateTimeline(fixed);
    if (revalidation.valid) {
      console.log(`   ✅ Timeline auto-fixed successfully`);
      return saveTimeline(scene.scene_id, fixed);
    } else {
      throw new Error(`Timeline validation failed and could not be auto-fixed`);
    }
  }
  
  if (validation.warnings.length > 0) {
    console.warn(`   ⚠️  Timeline warnings for scene ${scene.scene_id}:`);
    for (const warning of validation.warnings) {
      console.warn(`      • ${warning}`);
    }
  }
  return await saveTimeline(scene.scene_id, timeline);
}

/**
 * Save timeline to database
 */
async function saveTimeline(scene_id, timeline) {
  if (sb) {
    const project_id = timeline.project_id || '00000000-0000-0000-0000-000000000001';
    
    await sb.from('timelines').upsert({
      project_id,
      scene_id,
      timeline_json: timeline,
      created_at: new Date().toISOString()
    });
  }
  
  return timeline;
}