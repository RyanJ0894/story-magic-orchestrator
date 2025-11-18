import { execa } from 'execa';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import fs from 'fs';
import path from 'path';
import { getTrackPath } from '../lib/catalog-loader.js';

const ffmpeg = ffmpegPath;
const ffprobe = ffprobePath.path;

async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execa(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    return parseFloat(stdout);
  } catch (error) {
    console.error(`❌ Error getting duration for ${filePath}:`, error.message);
    return 0;
  }
}

export async function mixScene(options) {
  const { scene, timeline, stems, cues, output } = options;
  console.log('🎵 Mixing scene audio...');

  if (!stems || stems.length === 0) {
    console.log('⚠️  No dialogue stems - creating silent scene');
    await createSilence(output, 10);
    return;
  }

  console.log(`   📝 Concatenating ${stems.length} dialogue stems...`);
  const dialoguePath = path.join(path.dirname(output), `dialogue-${scene.scene_id}.m4a`);
  await concatenateDialogue(stems, dialoguePath);

  const dialogueDuration = await getAudioDuration(dialoguePath);
  console.log(`   ✅ Dialogue duration: ${dialogueDuration.toFixed(2)}s`);

  const timelineData = extractTimelineData(timeline, cues);

  if (!timelineData.music && !timelineData.ambience && timelineData.sfx.length === 0) {
    console.log('   ℹ️  No background tracks selected by cues - using dialogue only');
    fs.copyFileSync(dialoguePath, output);
    return;
  }

  const inputs = [{ path: dialoguePath, label: 'dialogue', index: 0 }];
  let inputIndex = 1;

  if (timelineData.music) {
    const trackPath = getTrackPath(timelineData.music.cue_id);
    if (trackPath) {
      inputs.push({ path: trackPath, label: 'music', index: inputIndex, data: timelineData.music });
      inputIndex++;
      console.log(`   🎵 Music: ${timelineData.music.cue_id}`);
    } else {
      console.warn(`   ⚠️  Music track not found: ${timelineData.music.cue_id}`);
      timelineData.music = null;
    }
  }

  if (timelineData.ambience) {
    const trackPath = getTrackPath(timelineData.ambience.cue_id);
    if (trackPath) {
      inputs.push({ path: trackPath, label: 'ambience', index: inputIndex, data: timelineData.ambience });
      inputIndex++;
      console.log(`   🌊 Ambience: ${timelineData.ambience.cue_id}`);
    } else {
      console.warn(`   ⚠️  Ambience track not found: ${timelineData.ambience.cue_id}`);
      timelineData.ambience = null;
    }
  }

  for (const sfx of timelineData.sfx) {
    const trackPath = getTrackPath(sfx.cue_id);
    if (trackPath) {
      inputs.push({ path: trackPath, label: `sfx${sfx.index}`, index: inputIndex, data: sfx });
      inputIndex++;
      console.log(`   🔊 SFX ${sfx.index + 1}: ${sfx.cue_id} @ ${sfx.at}s`);
    } else {
      console.warn(`   ⚠️  SFX track not found: ${sfx.cue_id}`);
    }
  }

  if (inputs.length === 1) {
    console.log('   ℹ️  All background tracks missing - using dialogue only');
    fs.copyFileSync(dialoguePath, output);
    return;
  }

  console.log('   🔧 Building FFmpeg filter graph with ducking...');
  const filterComplex = buildMixerFilterGraphWithDucking({ dialogueDuration, inputs, timelineData });

  const inputArgs = [];
  for (const input of inputs) {
    inputArgs.push('-i', input.path);
  }

  const args = [...inputArgs, '-filter_complex', filterComplex, '-map', '[final]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-y', output];

  console.log('   🎬 Running FFmpeg mixer...');
  
  try {
    await execa(ffmpeg, args);
    console.log('   ✅ Scene mixed successfully');
  } catch (error) {
    console.error('❌ FFmpeg mixing error:', error.stderr || error.message);
    console.log('   ⚠️  Falling back to dialogue-only output');
    fs.copyFileSync(dialoguePath, output);
  }
}

function extractTimelineData(timeline, cues) {
  const data = { music: null, ambience: null, sfx: [] };
  if (!timeline || !timeline.events) return data;

  const musicIn = timeline.events.find(e => e.type === 'music_in');
  const musicOut = timeline.events.find(e => e.type === 'music_out');
  if (musicIn && cues.music && cues.music.length > 0) {
    data.music = {
      cue_id: musicIn.cue_id || cues.music[0].cue_id,
      start: musicIn.at || 0,
      end: musicOut ? musicOut.at : null,
      fade_in: musicIn.fade || 1,
      fade_out: musicOut ? musicOut.fade : 2,
      gain_db: musicIn.gain_db || -12,
      duck_db: musicIn.duck_db || 7
    };
  }

  const ambienceIn = timeline.events.find(e => e.type === 'ambience_in');
  const ambienceOut = timeline.events.find(e => e.type === 'ambience_out');
  if (ambienceIn && cues.ambience && cues.ambience.length > 0) {
    data.ambience = {
      cue_id: ambienceIn.cue_id || cues.ambience[0].cue_id,
      start: ambienceIn.at || 0,
      end: ambienceOut ? ambienceOut.at : null,
      fade_in: ambienceIn.fade || 1.5,
      fade_out: ambienceOut ? ambienceOut.fade : 1.5,
      gain_db: ambienceIn.gain_db || -18
    };
  }

  const sfxEvents = timeline.events.filter(e => e.type === 'sfx_at');
  data.sfx = sfxEvents.map((event, index) => ({ cue_id: event.cue_id, at: event.at || 0, gain_db: event.gain_db || -6, index }));

  return data;
}

function buildMixerFilterGraphWithDucking({ dialogueDuration, inputs, timelineData }) {
  const filters = [];
  const layersToMix = [];
  const dialogueLabel = '[0:a]';
  layersToMix.push(dialogueLabel);

  if (timelineData.music) {
    const musicInput = inputs.find(i => i.label === 'music');
    if (musicInput) {
      const { start, end, fade_in, fade_out, gain_db } = timelineData.music;
      const duration = end ? (end - start) : dialogueDuration;

      filters.push(`[${musicInput.index}:a]aloop=loop=-1:size=2e+09,atrim=duration=${duration + (end ? fade_out : 0)},${start > 0 ? `adelay=${start * 1000}|${start * 1000},` : ''}volume=${gain_db}dB[music_pre]`);
      filters.push(`[music_pre]afade=t=in:st=${start}:d=${fade_in},afade=t=out:st=${Math.max(start, (end || dialogueDuration) - fade_out)}:d=${fade_out}[music_faded]`);
      filters.push(`[music_faded]${dialogueLabel}sidechaincompress=threshold=0.03:ratio=5:attack=100:release=400:knee=2.828427:level_in=1:level_sc=1:mix=1[music_ducked]`);
      layersToMix.push('[music_ducked]');
    }
  }

  if (timelineData.ambience) {
    const ambienceInput = inputs.find(i => i.label === 'ambience');
    if (ambienceInput) {
      const { start, end, fade_in, fade_out, gain_db } = timelineData.ambience;
      const duration = end ? (end - start) : dialogueDuration;
      filters.push(`[${ambienceInput.index}:a]aloop=loop=-1:size=2e+09,atrim=duration=${duration + (end ? fade_out : 0)},${start > 0 ? `adelay=${start * 1000}|${start * 1000},` : ''}volume=${gain_db}dB,afade=t=in:st=${start}:d=${fade_in},afade=t=out:st=${Math.max(start, (end || dialogueDuration) - fade_out)}:d=${fade_out}[ambience]`);
      layersToMix.push('[ambience]');
    }
  }

  for (const sfx of timelineData.sfx) {
    const sfxInput = inputs.find(i => i.data && i.data.cue_id === sfx.cue_id && i.data.index === sfx.index);
    if (sfxInput) {
      filters.push(`[${sfxInput.index}:a]adelay=${sfx.at * 1000}|${sfx.at * 1000},volume=${sfx.gain_db}dB[sfx${sfx.index}]`);
      layersToMix.push(`[sfx${sfx.index}]`);
    }
  }

  const mixFilter = `${layersToMix.join('')}amix=inputs=${layersToMix.length}:duration=longest:normalize=0[final]`;
  filters.push(mixFilter);
  return filters.join(';');
}

async function concatenateDialogue(stems, outputPath) {
  if (stems.length === 1) {
    fs.copyFileSync(stems[0].path, outputPath);
    return;
  }
  const concatList = stems.map(s => `file '${s.path}'`).join('\n');
  const concatFilePath = path.join(path.dirname(outputPath), 'concat-list.txt');
  fs.writeFileSync(concatFilePath, concatList);
  try {
    await execa(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', concatFilePath, '-c', 'copy', '-y', outputPath]);
  } finally {
    if (fs.existsSync(concatFilePath)) fs.unlinkSync(concatFilePath);
  }
}

async function createSilence(outputPath, duration) {
  await execa(ffmpeg, ['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', duration.toString(), '-c:a', 'aac', '-b:a', '192k', '-y', outputPath]);
}
