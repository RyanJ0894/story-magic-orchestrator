export async function pickCues(scene, catalog) {
  const music = [];
  const ambience = [];
  const sfx = [];

  // Use music tracks from Director JSON (array)
  if (scene.music && scene.music.length > 0) {
    for (const musicCue of scene.music) {
      music.push({
        cue_id: musicCue.cue_id || musicCue.track_id
      });
    }
  }

  // Use ambience from Director JSON (object, not array)
  if (scene.ambience && scene.ambience.cue_id) {
    ambience.push({
      cue_id: scene.ambience.cue_id || scene.ambience.track_id
    });
  }

  // Use SFX from Director JSON (array)
  if (scene.sfx && scene.sfx.length > 0) {
    for (const sfxCue of scene.sfx) {
      sfx.push({
        cue_id: sfxCue.cue_id || sfxCue.track_id,
        at: sfxCue.at || 0
      });
    }
  }

  return { music, ambience, sfx };
}
