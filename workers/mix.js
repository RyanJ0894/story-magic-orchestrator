// workers/mix.js - COMPLETE MIXER WITH FULL MIXING
import { execa } from 'execa';
import ffmpegPath from 'ffmpeg-static';
import ffprobePkg from 'ffprobe-static';
import fs from 'fs';
import path from 'path';
import { validateFiltergraph } from '../lib/ffmpeg-validator.js';
import { createClient } from '@supabase/supabase-js';

const ffmpeg = ffmpegPath;
const ffprobePath = ffprobePkg.path;

const sb = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

/**
 * Get audio duration in seconds
 */
async function audioDurationSec(filePath) {
  const { stdout } = await execa(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    filePath
  ]);
  const n = parseFloat(stdout.trim());
  if (!isFinite(n)) throw new Error('No duration ' + filePath);
  return n;
}

/**
 * Analyze RMS envelope for adaptive ducking
 * Returns array of {t, rmsDb} samples
 */
async function analyzeRMSEnvelope(dialoguePath, hop = 0.1) {
  const { stderr } = await execa(ffmpeg, [
    '-v', 'error',
    '-i', dialoguePath,
    '-af', `astats=metadata=1:reset=${hop}`,
    '-f', 'null',
    '-'
  ]);
  
  const lines = (stderr || '').split('\n');
  const env = [];
  let t = 0;
  
  for (const L of lines) {
    if (L.includes('RMS level')) {
      const v = parseFloat(L.split(':').pop().trim() || '-60');
      env.push({ t, rmsDb: v });
      t += hop;
    }
  }
  
  return env;
}

/**
 * Build adaptive ducking curve from RMS envelope
 * Louder dialogue = more ducking
 */
function buildDuckCurve(env) {
  return env.map(s => {
    if (s.rmsDb > -30) return { t: s.t, duckDb: -7 };      // Loud speech: duck -7dB
    if (s.rmsDb > -45) return { t: s.t, duckDb: -3 };      // Normal speech: duck -3dB
    return { t: s.t, duckDb: 0 };                           // Silence: no duck
  });
}

/**
 * Convert duck curve to FFmpeg volume enable expressions
 */
function duckToVolumeEnables(curve, hop = 0.1) {
  const segs = [];
  for (let i = 0; i < curve.length; i++) {
    const { duckDb } = curve[i];
    if (duckDb !== 0) {
      const t0 = (i * hop).toFixed(2);
      const t1 = ((i + 1) * hop).toFixed(2);
      segs.push(`volume=${duckDb}dB:enable='between(t,${t0},${t1})'`);
    }
  }
  return segs.length > 0 ? segs.join(',') : 'anull';
}

/**
 * Two-pass EBU R128 loudness normalization
 * Pass 1: Measure
 * Pass 2: Apply with measured values
 */
async function loudnormTwoPass(inputPath, outPath, I = -16, TP = -1, LRA = 11) {
  console.log(`   📊 Analyzing loudness (target: ${I} LUFS)...`);
  
  // Pass 1: Measure
  const pass1 = await execa(ffmpeg, [
    '-i', inputPath,
    '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`,
    '-f', 'null',
    '-'
  ], { reject: false });
  
  const txt = pass1.stderr || pass1.stdout || '';
  const rx = (k) => (txt.match(new RegExp(`"${k}"\\s*:\\s*"?(.*?)"?(,|\\s|$)`)) || [])[1];
  
  const measured_I = rx('input_i');
  const measured_TP = rx('input_tp');
  const measured_LRA = rx('input_lra');
  const measured_thresh = rx('input_thresh');
  const target_offset = rx('target_offset');
  
  console.log(`   📊 Measured: ${measured_I} LUFS, ${measured_TP} dBTP`);
  
  // Pass 2: Apply normalization
  console.log(`   🔊 Applying loudness normalization...`);
  await execa(ffmpeg, [
    '-i', inputPath,
    '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${measured_I}:measured_TP=${measured_TP}:measured_LRA=${measured_LRA}:measured_thresh=${measured_thresh}:offset=${target_offset}`,
    '-ar', '48000',
    '-c:a', 'aac',
    '-b:a', '192k',
    outPath
  ]);
  
  console.log(`   ✅ Normalized to ${I} LUFS`);
}

/**
 * Save mix manifest to database and file
 */
async function saveMixManifest(project_id, scene_id, manifest) {
  if (sb) {
    await sb.from('mix_manifests').upsert({
      project_id,
      scene_id,
      mix_manifest_json: manifest,
      created_at: new Date().toISOString()
    });
  }
  
  const localPath = path.join(process.cwd(), 'output', project_id, 'scenes', `${scene_id}-manifest.json`);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, JSON.stringify(manifest, null, 2));
}

/**
 * Complete scene mixer with adaptive ducking and loudness normalization
 * 
 * @param {Object} options
 * @param {string} options.project_id - Project ID
 * @param {string} options.scene_id - Scene ID
 * @param {Object} options.inputs - Input audio paths
 * @param {string} options.inputs.dialogue - Path to dialogue mix
 * @param {string} options.inputs.music - Path to music track (optional)
 * @param {string} options.inputs.ambience - Path to ambience track (optional)
 * @param {string} options.outWav - Output WAV path (pre-normalized)
 * @param {string} options.outFinal - Output final path (normalized)
 * @param {Object} options.mixParams - Mix parameters
 * @param {number} options.mixParams.music_gain_db - Music gain in dB (default: -12)
 * @param {number} options.mixParams.ambience_gain_db - Ambience gain in dB (default: -18)
 * @param {number} options.mixParams.target_lufs - Target loudness in LUFS (default: -16)
 * @param {number} options.mixParams.true_peak_db - True peak limit in dBTP (default: -1)
 */
export async function mixScene(options) {
  const {
    project_id,
    scene_id,
    inputs,
    outWav,
    outFinal,
    mixParams = {}
  } = options;
  
  const {
    music_gain_db = -12,
    ambience_gain_db = -18,
    target_lufs = -16,
    true_peak_db = -1
  } = mixParams;
  
  console.log(`   🎛️  Mixing scene audio...`);
  
  // Build manifest
  const manifest = {
    scene_id,
    inputs: {
      dialogue: [{ path: inputs.dialogue }],
      music: inputs.music ? [{ path: inputs.music, gain_db: music_gain_db }] : [],
      ambience: inputs.ambience ? [{ path: inputs.ambience, gain_db: ambience_gain_db }] : []
    },
    filters: [],
    lufs_i: null,
    true_peak_db: null
  };
  
  // If only dialogue, just copy and normalize
  if (!inputs.music && !inputs.ambience) {
    console.log(`   ℹ️  Dialogue-only scene (no music/ambience)`);
    fs.copyFileSync(inputs.dialogue, outWav);
    await loudnormTwoPass(outWav, outFinal, target_lufs, true_peak_db);
    
    manifest.filters.push('dialogue_only');
    await saveMixManifest(project_id, scene_id, manifest);
    return manifest;
  }
  
  // Analyze dialogue for adaptive ducking
  console.log(`   📊 Analyzing dialogue envelope for adaptive ducking...`);
  const env = await analyzeRMSEnvelope(inputs.dialogue, 0.1);
  const duckCurve = buildDuckCurve(env);
  const duckFilter = duckToVolumeEnables(duckCurve, 0.1);
  
  console.log(`   🎚️  Building adaptive ducking filter...`);
  
  // Build FFmpeg filter graph
  let filterGraph = '';
  let inputCount = 1; // Start at 1 (0 is dialogue)
  
  // Add music with adaptive ducking if present
  if (inputs.music) {
    filterGraph += `[${inputCount}:a]volume=${music_gain_db}dB[music_pre];`;
    filterGraph += `[music_pre]${duckFilter}[music];`;
    inputCount++;
    manifest.filters.push(`music_gain=${music_gain_db}dB`, 'adaptive_ducking');
  }
  
  // Add ambience if present
  if (inputs.ambience) {
    filterGraph += `[${inputCount}:a]volume=${ambience_gain_db}dB[ambience];`;
    inputCount++;
    manifest.filters.push(`ambience_gain=${ambience_gain_db}dB`);
  }
  
  // Mix all streams
  const mixInputs = ['[0:a]'];
  if (inputs.music) mixInputs.push('[music]');
  if (inputs.ambience) mixInputs.push('[ambience]');
  
  filterGraph += `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0[mix]`;
  
  // Validate filter graph
  const validation = validateFiltergraph(filterGraph);
  if (!validation.valid) {
    const errorMsg = `Invalid filtergraph:\n${validation.errors.join('\n')}`;
    console.error(errorMsg);
    console.error('Filtergraph:', filterGraph);
    throw new Error(errorMsg);
  }
  
  if (validation.warnings.length > 0) {
    console.warn('[Filtergraph Warnings]:', validation.warnings.join('; '));
  }
  
  // Build FFmpeg command
  const ffmpegArgs = ['-i', inputs.dialogue];
  if (inputs.music) ffmpegArgs.push('-i', inputs.music);
  if (inputs.ambience) ffmpegArgs.push('-i', inputs.ambience);
  
  ffmpegArgs.push(
    '-filter_complex', filterGraph,
    '-map', '[mix]',
    '-c:a', 'pcm_s16le',
    '-ar', '48000',
    outWav
  );
  
  console.log(`   🔧 Executing FFmpeg mix...`);
  await execa(ffmpeg, ffmpegArgs);
  
  // Normalize loudness
  await loudnormTwoPass(outWav, outFinal, target_lufs, true_peak_db);
  
  // Measure final LUFS
  const { stderr } = await execa(ffmpeg, [
    '-i', outFinal,
    '-af', 'loudnorm=I=-16:TP=-1:LRA=11:print_format=json',
    '-f', 'null',
    '-'
  ], { reject: false });
  
  const txt = stderr || '';
  const outputI = (txt.match(/"output_i"\s*:\s*"?(.*?)"?(,|\s|$)/) || [])[1];
  const outputTP = (txt.match(/"output_tp"\s*:\s*"?(.*?)"?(,|\s|$)/) || [])[1];
  
  manifest.lufs_i = outputI ? parseFloat(outputI) : null;
  manifest.true_peak_db = outputTP ? parseFloat(outputTP) : null;
  
  console.log(`   ✅ Final mix: ${manifest.lufs_i?.toFixed(2)} LUFS, ${manifest.true_peak_db?.toFixed(2)} dBTP`);
  
  // Save manifest
  await saveMixManifest(project_id, scene_id, manifest);
  
  return manifest;
}