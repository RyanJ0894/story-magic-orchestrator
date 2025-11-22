import fs from 'fs';
import path from 'path';

const CATALOG_BASE = 'catalog';

export function loadCatalog() {
  console.log('📂 Loading audio catalog from:', CATALOG_BASE);
  const catalog = { music: [], ambience: [], sfx: [] };  
  try {
    if (!fs.existsSync(CATALOG_BASE)) {
      console.warn(`⚠️  Catalog directory not found: ${CATALOG_BASE}`);
      fs.mkdirSync(path.join(CATALOG_BASE, 'music'), { recursive: true });
      fs.mkdirSync(path.join(CATALOG_BASE, 'ambience'), { recursive: true });
      fs.mkdirSync(path.join(CATALOG_BASE, 'sfx'), { recursive: true });
      return catalog;
    }

    const musicDir = path.join(CATALOG_BASE, 'music');
    if (fs.existsSync(musicDir)) {
      const musicFiles = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a'));
      for (const file of musicFiles) {
        catalog.music.push({ id: `music/${file}`, path: path.join(musicDir, file), filename: file });
      }
      console.log(`   ✅ Loaded ${catalog.music.length} music tracks`);
    }

    const ambienceDir = path.join(CATALOG_BASE, 'ambience');
    if (fs.existsSync(ambienceDir)) {
      const ambienceFiles = fs.readdirSync(ambienceDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a'));
      for (const file of ambienceFiles) {
        catalog.ambience.push({ id: `ambience/${file}`, path: path.join(ambienceDir, file), filename: file });
      }
      console.log(`   ✅ Loaded ${catalog.ambience.length} ambience tracks`);
    }

    const sfxDir = path.join(CATALOG_BASE, 'sfx');
    if (fs.existsSync(sfxDir)) {
      const sfxFiles = fs.readdirSync(sfxDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a'));
      for (const file of sfxFiles) {
        catalog.sfx.push({ id: `sfx/${file}`, path: path.join(sfxDir, file), filename: file });
      }
      console.log(`   ✅ Loaded ${catalog.sfx.length} SFX files`);
    }

    return catalog;
  } catch (error) {
    console.error('❌ Error loading catalog:', error);
    return catalog;
  }
}

export function getTrackPath(trackId) {
  if (!trackId) return null;

  const tryFile = (id) => {
    const filePath = path.join(CATALOG_BASE, id);
    return fs.existsSync(filePath) ? filePath : null;
  };

  // 1. Try original
  let result = tryFile(trackId);
  if (result) return result;

  // 2. Try switching extension (.mp3 <-> .wav)
  const ext = path.extname(trackId).toLowerCase();
  const base = trackId.slice(0, -ext.length);

  let altId = null;
  if (ext === ".mp3") altId = base + ".wav";
  else if (ext === ".wav") altId = base + ".mp3";

  if (altId) {
    result = tryFile(altId);
    if (result) return result;
  }

  console.warn(`⚠️  Track not found: ${path.join(CATALOG_BASE, trackId)} or alternative extension`);
  return null;
}

export function validateSceneTracks(scene) {
  const missing = [];
  if (scene.music) {
    for (const musicCue of scene.music) {
      if (!getTrackPath(musicCue.track_id)) missing.push(musicCue.track_id);
    }
  }
  if (scene.ambience?.track_id && !getTrackPath(scene.ambience.track_id)) missing.push(scene.ambience.track_id);
  if (scene.sfx) {
    for (const sfxCue of scene.sfx) {
      if (!getTrackPath(sfxCue.track_id)) missing.push(sfxCue.track_id);
    }
  }
  return { valid: missing.length === 0, missing };
}
