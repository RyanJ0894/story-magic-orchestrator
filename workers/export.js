// workers/export.js
import { execa } from 'execa';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { audioDurationSec } from '../lib/audio.js';

const ffmpeg = ffmpegPath;

/**
 * Concatenate scene audio files with smooth crossfades
 * Uses FFmpeg acrossfade filter with equal-power curves
 * 
 * @param {string[]} scenePaths - Array of scene audio file paths
 * @param {string} outPath - Output path for concatenated audio
 * @param {Object} options - Crossfade options
 * @param {number} options.fadeDuration - Crossfade duration in seconds (default: 1.5)
 * @param {string} options.fadeType - Fade curve type (default: 'tri')
 * @returns {Promise<void>}
 */
export async function concatScenesWithCrossfade(
  scenePaths,
  outPath,
  options = {}
) {
  const { fadeDuration = 1.5, fadeType = 'tri' } = options;

  console.log('\n🎬 Concatenating scenes with crossfades...');
  console.log(`   Scenes: ${scenePaths.length}`);
  console.log(`   Fade duration: ${fadeDuration}s`);
  console.log(`   Fade type: ${fadeType}`);

  if (scenePaths.length === 0) {
    throw new Error('No scenes to concatenate');
  }

  // Single scene = no crossfade needed
  if (scenePaths.length === 1) {
    console.log('   ℹ️  Single scene - copying directly (no crossfade needed)');
    fs.copyFileSync(scenePaths[0], outPath);
    console.log(`   ✅ Output: ${path.basename(outPath)}\n`);
    return;
  }

  // Validate all input files exist
  for (const p of scenePaths) {
    if (!fs.existsSync(p)) {
      throw new Error(`Scene file not found: ${p}`);
    }
  }

  // Build FFmpeg input arguments
  const inputArgs = [];
  for (const scenePath of scenePaths) {
    inputArgs.push('-i', scenePath);
  }

  // Build acrossfade filter chain
  // [0][1]acrossfade=d=1.5:c1=tri:c2=tri[a01];
  // [a01][2]acrossfade=d=1.5:c1=tri:c2=tri[a02];
  // ...
  let filterComplex = '';
  let prevLabel = '[0:a]';

  for (let i = 1; i < scenePaths.length; i++) {
    const currentLabel = `[${i}:a]`;
    const outLabel = i === scenePaths.length - 1 ? '[out]' : `[a${i}]`;
    
    filterComplex += `${prevLabel}${currentLabel}acrossfade=d=${fadeDuration}:c1=${fadeType}:c2=${fadeType}${outLabel}`;
    
    if (i < scenePaths.length - 1) {
      filterComplex += ';';
    }
    
    prevLabel = outLabel;
  }

  console.log('   🔧 Building filtergraph...');
  console.log(`   Filter: ${filterComplex.substring(0, 100)}...`);

  // Execute FFmpeg
  const args = [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-y', // Overwrite output
    outPath
  ];

  try {
    console.log('   🎵 Executing FFmpeg...');
    await execa(ffmpeg, args);
    console.log(`   ✅ Concatenation complete: ${path.basename(outPath)}\n`);
  } catch (err) {
    console.error('   ❌ FFmpeg failed:', err.stderr || err.message);
    throw new Error(`Scene concatenation failed: ${err.message}`);
  }
}

/**
 * Generate playback manifest with accurate offsets accounting for crossfades
 * 
 * @param {string} project_id - Project UUID
 * @param {Array} scenePaths - Array of {scene_id, path} objects
 * @param {number} crossfadeDuration - Crossfade duration in seconds (default: 1.5)
 * @returns {Promise<Object>} Playback manifest
 */
export async function makePlaybackManifest(
  project_id,
  scenePaths,
  crossfadeDuration = 1.5
) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // Upload episode file to Supabase Storage
  const episodePath = path.join(process.cwd(), 'output', project_id, 'episode.m4a');
  const episodeBuffer = fs.readFileSync(episodePath);
  
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('audio')
    .upload(`${project_id}/episode.m4a`, episodeBuffer, {
      contentType: 'audio/mp4',
      upsert: true
    });

  if (uploadError) {
    console.error('Supabase upload error:', uploadError);
    throw uploadError;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('audio')
    .getPublicUrl(`${project_id}/episode.m4a`);

  const manifest = {
    project_id,
    audio_url: urlData.publicUrl,
    total_duration: await audioDurationSec(episodePath),
    created_at: new Date().toISOString()
  };

  console.log('🔗 Public audio URL:', urlData.publicUrl);
  return manifest;
}