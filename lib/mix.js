// lib/mix.js
import { execa } from 'execa';
import ffmpegPath from 'ffmpeg-static';

const ffmpeg = ffmpegPath;

/**
 * Analyze RMS envelope of dialogue to drive adaptive ducking
 * Returns array of { t: time, rmsDb: RMS level in dB }
 */
export async function analyzeRMSEnvelope(dialoguePath, hop = 0.1) {
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

  for (const line of lines) {
    if (line.includes('RMS level')) {
      const valueStr = line.split(':').pop()?.trim() || '-60';
      const rmsDb = parseFloat(valueStr);
      env.push({ t, rmsDb });
      t += hop;
    }
  }

  return env;
}

/**
 * Build ducking curve from RMS envelope
 * Maps RMS levels to ducking amounts:
 * - Loud dialogue (>-30 dB) → -7 dB duck
 * - Normal dialogue (-30 to -45 dB) → -3 dB duck
 * - Quiet/silence (<-45 dB) → 0 dB (no duck)
 */
export function buildDuckCurve(env) {
  return env.map(sample => {
    if (sample.rmsDb > -30) {
      return { t: sample.t, duckDb: -7 };
    } else if (sample.rmsDb > -45) {
      return { t: sample.t, duckDb: -3 };
    } else {
      return { t: sample.t, duckDb: 0 };
    }
  });
}

/**
 * Convert ducking curve to FFmpeg volume filter enables
 * Generates time-based volume adjustments for adaptive ducking
 */
export function duckToVolumeEnables(curve, hop = 0.1) {
  const segments = [];
  
  for (let i = 0; i < curve.length; i++) {
    const { duckDb } = curve[i];
    
    if (duckDb !== 0) {
      const t0 = (i * hop).toFixed(2);
      const t1 = ((i + 1) * hop).toFixed(2);
      segments.push(`[m]volume=${duckDb}dB:enable='between(t,${t0},${t1})'[m];`);
    }
  }
  
  return segments.join('');
}

/**
 * Two-pass EBU R128 loudness normalization
 * Pass 1: Analyze input loudness
 * Pass 2: Apply normalization to hit target LUFS
 */
export async function loudnormTwoPass(
  inputPath,
  outPath,
  targetLUFS = -16,
  truePeakDB = -1,
  LRA = 11
) {
  // Pass 1: Analyze
  const pass1 = await execa(ffmpeg, [
    '-i', inputPath,
    '-af', `loudnorm=I=${targetLUFS}:TP=${truePeakDB}:LRA=${LRA}:print_format=json`,
    '-f', 'null',
    '-'
  ], { reject: false });

  const analysisText = pass1.stderr || pass1.stdout || '';
  
  // Extract measured values with regex
  const extractValue = (key) => {
    const match = analysisText.match(new RegExp(`"${key}"\\s*:\\s*"?([^",\\s]+)"?`));
    return match ? match[1] : '0';
  };

  const measuredI = extractValue('input_i');
  const measuredTP = extractValue('input_tp');
  const measuredLRA = extractValue('input_lra');
  const measuredThresh = extractValue('input_thresh');
  const targetOffset = extractValue('target_offset');

  // Pass 2: Normalize
  await execa(ffmpeg, [
    '-i', inputPath,
    '-af', `loudnorm=I=${targetLUFS}:TP=${truePeakDB}:LRA=${LRA}:measured_I=${measuredI}:measured_TP=${measuredTP}:measured_LRA=${measuredLRA}:measured_thresh=${measuredThresh}:offset=${targetOffset}`,
    '-ar', '48000',
    '-c:a', 'aac',
    '-b:a', '192k',
    outPath
  ]);
}