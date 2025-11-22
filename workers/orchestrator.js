import 'dotenv/config';
import { DirectorJSON } from '../lib/zod-schemas.js';
import { ttsForScene } from './tts.js';
import { alignScene } from './align.js';
import { pickCues } from './cues.js';
import { buildTimeline } from './timeline.js';
import { mixScene } from './mixer.js';
import { concatScenesWithCrossfade, makePlaybackManifest } from './export.js';
import { loadCatalog } from '../lib/catalog-loader.js';
import path from 'path';
import fs from 'fs';

export async function orchestrate(directorJSON) {
  console.log('🎬 Step 0: Validating Director JSON...');
  const parsed = DirectorJSON.safeParse(directorJSON);
  if (!parsed.success) {
    throw new Error('Invalid Director JSON: ' + JSON.stringify(parsed.error.issues));
  }
  const director = parsed.data;
  console.log(`   ✅ Valid Director JSON for project: ${director.project_id}`);
  console.log(`   📋 Scenes to process: ${director.scenes.length}\n`);
  console.log('📚 Loading audio catalog...');
  const catalog = loadCatalog();
  console.log('');
  const projectDir = path.join(process.cwd(), 'output', director.project_id);
  const scenesDir = path.join(projectDir, 'scenes');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(scenesDir, { recursive: true });
  const sceneOutputs = [];
  for (const scene of director.scenes) {
    console.log('─'.repeat(80));
    console.log(`🎬 SCENE ${director.scenes.indexOf(scene) + 1}/${director.scenes.length}: ${scene.scene_id}`);
    console.log('─'.repeat(80) + '\n');
    console.log(`🔊 Step 1: Generating TTS for ${scene.dialogue.length} lines...`);
    const stems = await ttsForScene(director.project_id, scene);
    console.log(`   ✅ Generated ${stems.length} dialogue stems\n`);
    console.log('⏱️  Step 2: Computing dialogue alignment...');
    const alignment = await alignScene(director.project_id, scene, stems);
    console.log(`   ✅ Aligned ${alignment.lines.length} lines\n`);
    console.log('🎵 Step 3: Selecting music and ambience cues...');
    const cues = await pickCues(scene, catalog);
    console.log(`   ✅ Music cues: ${cues.music ? cues.music.length : 0}`);
    console.log(`   ✅ Ambience cues: ${cues.ambience ? cues.ambience.length : 0}\n`);
    console.log('📅 Step 4: Building scene timeline...');
    const timeline = await buildTimeline(scene, alignment, cues);
    console.log(`   ✅ Timeline built with ${timeline.events ? timeline.events.length : 0} events\n`);
    console.log('🎵 Step 5: Mixing scene audio with background tracks...');
    const sceneOutput = path.join(projectDir, `scene-${scene.scene_id}.m4a`);
    await mixScene({ scene, timeline, stems, cues, output: sceneOutput });
    console.log(`   ✅ Scene mixed: ${path.basename(sceneOutput)}\n`);
    sceneOutputs.push({ scene_id: scene.scene_id, path: sceneOutput, timeline, alignment, cues });
  }
  console.log('─'.repeat(80));
  console.log('✅ ALL SCENES PROCESSED - STARTING FINAL EXPORT');
  console.log('─'.repeat(80) + '\n');
  console.log('🎬 Step 6: Concatenating scenes...');
  const episodePath = path.join(projectDir, 'episode.m4a');
  await concatScenesWithCrossfade(sceneOutputs.map(s => s.path), episodePath, { fadeDuration: 1.5, fadeType: 'tri' });
  console.log(`   ✅ Episode created: ${path.basename(episodePath)}\n`);
  console.log('📄 Step 7: Generating playback manifest...');
  const manifest = await makePlaybackManifest(director.project_id, sceneOutputs.map(s => ({ scene_id: s.scene_id, path: s.path })), 1.5);
  const manifestPath = path.join(projectDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`   ✅ Manifest saved: manifest.json\n`);
  console.log('═'.repeat(80));
  console.log('🎊 ORCHESTRATION COMPLETE!');
  console.log('═'.repeat(80) + '\n');
  console.log(`📁 Output directory: ${projectDir}`);
  console.log(`🎵 Episode file: episode.m4a`);
  console.log(`📄 Manifest: manifest.json`);
  console.log(`⏱️  Total duration: ${manifest.total.toFixed(2)}s (${(manifest.total / 60).toFixed(2)} min)`);
  console.log('═'.repeat(80) + '\n');
  return {
    project_id: director.project_id,
    output_dir: projectDir,
    episode_path: episodePath,
    manifest_path: manifestPath,
    scenes: sceneOutputs,
    audio_urls: [manifest.public_url],
    manifest: manifest
  };
}
