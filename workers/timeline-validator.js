// workers/timeline-validator.js - TIMELINE OVERLAP VALIDATION
/**
 * Validate timeline for overlaps and conflicts
 * Ensures no invalid audio stacking or masking
 */

export function validateTimeline(timeline) {
  const errors = [];
  const warnings = [];
  
  const { events } = timeline;
  
  // Group events by type
  const musicEvents = events.filter(e => e.type === 'music_in' || e.type === 'music_out');
  const ambienceEvents = events.filter(e => e.type === 'ambience_in' || e.type === 'ambience_out');
  const dialogueEvents = events.filter(e => e.type === 'dialogue_in' || e.type === 'dialogue_out');
  
  // 1. Check for overlapping music tracks (not allowed unless crossfade)
  const activeMusicTracks = new Map(); // cue_id -> {start, end}
  
  for (const event of musicEvents.sort((a, b) => a.at - b.at)) {
    if (event.type === 'music_in') {
      // Check if another track is already active
      for (const [cueId, range] of activeMusicTracks.entries()) {
        if (event.at < range.end) {
          // Check if this is a valid crossfade
          const outEvent = musicEvents.find(e => e.type === 'music_out' && e.cue_id === cueId);
          const fadeWindow = outEvent ? (outEvent.fade || 2) : 2;
          
          if (event.at < range.end - fadeWindow) {
            errors.push(
              `Music overlap detected: track ${event.cue_id} starts at ${event.at}s ` +
              `while ${cueId} is still active until ${range.end}s (not a valid crossfade)`
            );
          }
        }
      }
      
      activeMusicTracks.set(event.cue_id, { start: event.at, end: Infinity });
    } else if (event.type === 'music_out') {
      const range = activeMusicTracks.get(event.cue_id);
      if (range) {
        range.end = event.at;
      }
    }
  }
  
  // 2. Check for overlapping ambience tracks
  const activeAmbienceTracks = new Map();
  
  for (const event of ambienceEvents.sort((a, b) => a.at - b.at)) {
    if (event.type === 'ambience_in') {
      for (const [cueId, range] of activeAmbienceTracks.entries()) {
        if (event.at < range.end) {
          warnings.push(
            `Ambience overlap detected: track ${event.cue_id} starts at ${event.at}s ` +
            `while ${cueId} is still active (may cause muddiness)`
          );
        }
      }
      
      activeAmbienceTracks.set(event.cue_id, { start: event.at, end: Infinity });
    } else if (event.type === 'ambience_out') {
      const range = activeAmbienceTracks.get(event.cue_id);
      if (range) {
        range.end = event.at;
      }
    }
  }
  
  // 3. Check for dialogue masking (music/ambience too loud during dialogue)
  const activeDialogue = [];
  
  for (const event of dialogueEvents.sort((a, b) => a.at - b.at)) {
    if (event.type === 'dialogue_in') {
      activeDialogue.push({ line_id: event.line_id, start: event.at, end: Infinity });
    } else if (event.type === 'dialogue_out') {
      const line = activeDialogue.find(l => l.line_id === event.line_id);
      if (line) {
        line.end = event.at;
      }
    }
  }
  
  // Check if music/ambience is active during dialogue
  for (const line of activeDialogue) {
    // Check music
    for (const event of musicEvents) {
      if (event.type === 'music_in' && event.at < line.end) {
        const musicOut = musicEvents.find(e => e.type === 'music_out' && e.cue_id === event.cue_id);
        const musicEnd = musicOut ? musicOut.at : Infinity;
        
        if (musicEnd > line.start) {
          // Music is active during dialogue - check if ducking is applied
          if (!event.duck_db || event.duck_db < 3) {
            warnings.push(
              `Insufficient music ducking during dialogue (line ${line.line_id} at ${line.start}s). ` +
              `Current duck: ${event.duck_db || 0}dB, recommended: ≥6dB`
            );
          }
        }
      }
    }
    
    // Check ambience
    for (const event of ambienceEvents) {
      if (event.type === 'ambience_in' && event.at < line.end) {
        const ambienceOut = ambienceEvents.find(e => e.type === 'ambience_out' && e.cue_id === event.cue_id);
        const ambienceEnd = ambienceOut ? ambienceOut.at : Infinity;
        
        if (ambienceEnd > line.start) {
          // Ambience is active during dialogue - check gain
          if (!event.gain_db || event.gain_db > -15) {
            warnings.push(
              `Ambience may mask dialogue (line ${line.line_id} at ${line.start}s). ` +
              `Current gain: ${event.gain_db || 0}dB, recommended: ≤-18dB`
            );
          }
        }
      }
    }
  }
  
  // 4. Check for events out of order
  const allEvents = events.slice().sort((a, b) => a.at - b.at);
  for (let i = 1; i < allEvents.length; i++) {
    if (allEvents[i].at < allEvents[i - 1].at) {
      errors.push(`Events out of order: event at ${allEvents[i].at}s comes before ${allEvents[i - 1].at}s`);
    }
  }
  
  // 5. Check for orphaned out events (out without in)
  const musicIns = new Set(musicEvents.filter(e => e.type === 'music_in').map(e => e.cue_id));
  const musicOuts = new Set(musicEvents.filter(e => e.type === 'music_out').map(e => e.cue_id));
  
  for (const cueId of musicOuts) {
    if (!musicIns.has(cueId)) {
      errors.push(`Orphaned music_out event for cue ${cueId} (no corresponding music_in)`);
    }
  }
  
  const ambienceIns = new Set(ambienceEvents.filter(e => e.type === 'ambience_in').map(e => e.cue_id));
  const ambienceOuts = new Set(ambienceEvents.filter(e => e.type === 'ambience_out').map(e => e.cue_id));
  
  for (const cueId of ambienceOuts) {
    if (!ambienceIns.has(cueId)) {
      errors.push(`Orphaned ambience_out event for cue ${cueId} (no corresponding ambience_in)`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Fix common timeline issues automatically
 */
export function autoFixTimeline(timeline) {
  const { events } = timeline;
  const fixed = [];
  
  // Sort events by time
  const sorted = events.slice().sort((a, b) => a.at - b.at);
  
  // Remove orphaned out events
  const insMap = new Map();
  for (const event of sorted) {
    if (event.type.endsWith('_in')) {
      insMap.set(event.cue_id, true);
      fixed.push(event);
    } else if (event.type.endsWith('_out')) {
      if (insMap.has(event.cue_id)) {
        fixed.push(event);
      } else {
        console.warn(`Removing orphaned ${event.type} event for ${event.cue_id}`);
      }
    } else {
      fixed.push(event);
    }
  }
  
  return {
    ...timeline,
    events: fixed
  };
}