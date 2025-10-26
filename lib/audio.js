// lib/audio.js
import ffmpegPath from 'ffmpeg-static';
import ffprobePkg from 'ffprobe-static';
import { execa } from 'execa';
import { withRetry, RetryableError } from './retry.js';

const ffprobePath = ffprobePkg.path;
const ffmpeg = ffmpegPath;

export async function audioDurationSec(filePath) {
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

async function transcodeMp3ToWav(mp3) {
  const { stdout } = await execa(ffmpeg, [
    '-v', 'error',
    '-i', 'pipe:0',
    '-f', 'wav',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1'
  ], { 
    input: mp3,
    encoding: 'buffer'
  });
  return stdout;
}

export async function ttsGenerate(opts) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');

  return withRetry(async () => {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${opts.voice.voice_id}/stream?optimize_streaming_latency=0`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: opts.text,
          voice_settings: opts.voice.params_json || {
            stability: 0.4,
            similarity_boost: 0.7
          },
          output_format: 'mp3_44100_128'
        })
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableError(
          `ElevenLabs TTS failed ${res.status}: ${errorText}`,
          res.status,
          true
        );
      }
      throw new RetryableError(
        `ElevenLabs TTS failed ${res.status}: ${errorText}`,
        res.status,
        false
      );
    }

    return transcodeMp3ToWav(Buffer.from(await res.arrayBuffer()));
  }, {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    jitterFactor: 0.2,
    retryableStatuses: [429, 500, 502, 503, 504]
  });
}