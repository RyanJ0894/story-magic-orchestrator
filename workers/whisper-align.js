// workers/whisper-align.js - WHISPER ASR FOR ACCURATE ALIGNMENT
import { execa } from 'execa';
import fs from 'fs';
import path from 'path';
import { withRetry } from '../lib/retry.js';

/**
 * Use Whisper to get word-level timestamps from audio
 * Requires whisper.cpp or OpenAI Whisper API
 * 
 * @param {string} audioPath - Path to audio file
 * @param {string} expectedText - Expected text for validation
 * @returns {Array} Array of word objects with {word, start, end}
 */
export async function whisperAlign(audioPath, expectedText) {
  console.log(`   🎙️  Running Whisper ASR for word-level alignment...`);
  
  // Try whisper.cpp if available
  const whisperCppPath = process.env.WHISPER_CPP_PATH || 'whisper';
  const modelPath = process.env.WHISPER_MODEL_PATH || 'models/ggml-base.en.bin';
  
  try {
    // Check if whisper.cpp is available
    await execa('which', ['whisper'], { reject: true });
    
    // Run whisper.cpp with word timestamps
    const { stdout } = await execa(whisperCppPath, [
      '-m', modelPath,
      '-f', audioPath,
      '-ojf',  // Output JSON format
      '-ml', '1',  // Max line length = 1 word per line
      '-otxt', // Output text format
    ]);
    
    // Parse whisper.cpp output
    const words = parseWhisperCppOutput(stdout, expectedText);
    console.log(`   ✅ Whisper aligned ${words.length} words`);
    return words;
    
  } catch (err) {
    console.warn(`   ⚠️  whisper.cpp not available, trying OpenAI Whisper API...`);
    
    // Fallback to OpenAI Whisper API
    if (process.env.OPENAI_API_KEY) {
      return await whisperAPIAlign(audioPath, expectedText);
    }
    
    console.warn(`   ⚠️  No Whisper available, using duration-based fallback`);
    return null;
  }
}

/**
 * Parse whisper.cpp JSON output
 */
function parseWhisperCppOutput(stdout, expectedText) {
  const words = [];
  
  try {
    const data = JSON.parse(stdout);
    
    if (data.transcription && Array.isArray(data.transcription)) {
      for (const segment of data.transcription) {
        if (segment.timestamps) {
          for (const ts of segment.timestamps) {
            words.push({
              word: ts.text.trim(),
              start: ts.from / 1000,  // Convert ms to seconds
              end: ts.to / 1000
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('   ❌ Failed to parse whisper.cpp output:', err.message);
  }
  
  return words;
}

/**
 * Use OpenAI Whisper API for word-level timestamps
 */
async function whisperAPIAlign(audioPath, expectedText) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  return withRetry(async () => {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders()
      },
      body: form
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Whisper API failed: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    // Extract word-level timestamps
    const words = [];
    if (data.words) {
      for (const w of data.words) {
        words.push({
          word: w.word,
          start: w.start,
          end: w.end
        });
      }
    }
    
    console.log(`   ✅ Whisper API aligned ${words.length} words`);
    return words;
    
  }, {
    maxRetries: 3,
    initialDelayMs: 1000,
    retryableStatuses: [429, 500, 502, 503, 504]
  });
}

/**
 * Map word timestamps to punctuation positions
 * Uses fuzzy matching to handle transcription differences
 */
export function mapWordsToText(words, text) {
  const textWords = text.toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
  
  const wordTimestamps = [];
  let wordIdx = 0;
  
  for (const tw of textWords) {
    // Find best matching word in whisper output
    let bestMatch = null;
    let bestScore = 0;
    
    for (let i = wordIdx; i < Math.min(wordIdx + 5, words.length); i++) {
      const w = words[i];
      const score = similarity(tw, w.word.toLowerCase());
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ...w, textWord: tw };
      }
    }
    
    if (bestMatch && bestScore > 0.6) {
      wordTimestamps.push(bestMatch);
      wordIdx++;
    }
  }
  
  return wordTimestamps;
}

/**
 * Simple string similarity score (Levenshtein-based)
 */
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshtein(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}