export async function pickCues(scene, catalog) {
  console.log(`\n🔍 DIAGNOSTIC pickCues for scene ${scene.scene_id}:`);
  console.log(`   Scene has music array:`, !!scene.music, `(length: ${scene.music?.length || 0})`);
  console.log(`   Scene has ambience object:`, !!scene.ambience);
  console.log(`   Scene has sfx array:`, !!scene.sfx, `(length: ${scene.sfx?.length || 0})`);

  const music = [];
  const ambience = [];
  const sfx = [];

  if (scene.music && scene.music.length > 0) {
    for (const musicCue of scene.music) {
      const cueId = musicCue.cue_id || musicCue.track_id;
      console.log(`   🎵 DIAGNOSTIC: Adding music cue_id="${cueId}"`);
      music.push({ cue_id: cueId });
    }
  }

  if (scene.ambience && scene.ambience.track_id) {
    const cueId = scene.ambience.cue_id || scene.ambience.track_id;
    console.log(`   🌊 DIAGNOSTIC: Adding ambience cue_id="${cueId}"`);
    ambience.push({ cue_id: cueId });
  }

  if (scene.sfx && scene.sfx.length > 0) {
    for (const sfxCue of scene.sfx) {
      const cueId = sfxCue.cue_id || sfxCue.track_id;
      console.log(`   💥 DIAGNOSTIC: Adding SFX cue_id="${cueId}" at ${sfxCue.at}s`);
      sfx.push({
        cue_id: cueId,
        at: sfxCue.at || 0
      });
    }
  }

  console.log(`✅ DIAGNOSTIC pickCues result:`, {
    music_count: music.length,
    ambience_count: ambience.length,
    sfx_count: sfx.length
  });
  return {"music":scene.music, "ambience":scene.ambience, "sfx":scene.sfx };
}
