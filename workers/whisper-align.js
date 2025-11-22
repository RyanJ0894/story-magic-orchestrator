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

// Start here
// workers/whisper-align.js

export async function whisperAlign(audioPath, expectedText) {
  console.log(`   🎙️  Running Whisper ASR for word-level alignment...`);
  
  const whisperCppPath = process.env.WHISPER_CPP_PATH || 'whisper';
  const modelPath = process.env.WHISPER_MODEL_PATH || 'models/ggml-base.en.bin';

  // 1. Create a specific path for the JSON output file
  // We strip the extension from the audio path to create a base name
  const outputBase = audioPath.replace(/\.[^/.]+$/, ""); 
  const jsonOutputPath = `${outputBase}.json`;

  try {
    if (whisperCppPath !== 'whisper' && !fs.existsSync(whisperCppPath)) {
        throw new Error(`Local whisper binary not found at: ${whisperCppPath}`);
    }

    // 2. Run whisper.cpp
    // We add '-of', outputBase to tell it exactly where to save the file
    await execa(whisperCppPath, [
      '-m', modelPath,
      '-f', audioPath,
      '-ojf',       // Create JSON file
      '-of', outputBase, // Specify output filename (whisper adds extensions automatically)
      '-ml', '1',   // Max line length
    ]);
    
    // 3. Check if JSON file was created
    if (!fs.existsSync(jsonOutputPath)) {
        throw new Error(`Whisper finished but JSON file is missing at: ${jsonOutputPath}`);
    }

    // 4. Read the JSON file from disk
    const jsonContent = fs.readFileSync(jsonOutputPath, 'utf8');

    // 5. Parse the content
    const words = parseWhisperCppOutput(jsonContent, expectedText);
    
    // 6. CLEANUP: Delete the generated .json file to keep folder clean
    try {
        fs.unlinkSync(jsonOutputPath);
    } catch (e) {
        console.warn("Warning: Could not delete temp JSON file:", e.message);
    }

    console.log(`   ✅ Whisper aligned ${words.length} words`);
    return words;
    
  } catch (err) {
    console.warn(`   ⚠️  whisper.cpp failed, trying OpenAI Whisper API...`);
    console.log(`   ❌ Error details: ${err.message}`);
    
    // Fallback to OpenAI Whisper API
    if (process.env.OPENAI_API_KEY) {
      return await whisperAPIAlign(audioPath, expectedText);
    }
    
    console.warn(`   ⚠️  No Whisper available, using duration-based fallback`);
    return null;
  }
}

// Keep your existing parseWhisperCppOutput function exactly as it is
function parseWhisperCppOutput(jsonString, expectedText) {
  const words = [];
  
  try {
    const data = JSON.parse(jsonString);
    
    // valid check
    if (!data.transcription || !Array.isArray(data.transcription)) {
        console.warn("   ⚠️  JSON format unexpected: 'transcription' array missing");
        console.log("   🔍 JSON Preview:", jsonString.substring(0, 200));
        return [];
    }

    // DEBUG: Log the first segment to understand the structure


    for (const segment of data.transcription) {
      // STRATEGY A: The segment IS the word (Common with -ml 1)
      // We look for 'offsets' (ms integers) or 'timestamps' (objects)
      let start = null;
      let end = null;
      let text = segment.text;

      if (segment.offsets) {
        // "offsets": { "from": 20, "to": 190 }
        start = segment.offsets.from / 1000.0;
        end = segment.offsets.to / 1000.0;
      } else if (segment.timestamps && segment.timestamps.from) {
         // "timestamps": { "from": "00:00:00,020", ... }
         // We'd have to parse string, but usually 'offsets' is there.
         // Let's skip complex parsing if 'offsets' is missing for now and rely on 'from'/'to' keys if they exist directly
      } else if (typeof segment.from === 'number' && typeof segment.to === 'number') {
         // Direct properties (some versions)
         start = segment.from / 1000.0; // check if it's seconds or ms. usually seconds if float, ms if int.
         // Actually whisper.cpp JSON often uses 'offsets' for ms.
      }

      // If we found a valid time range and text
      if (start !== null && end !== null && text) {
          words.push({
              word: text.trim(),
              start: start,
              end: end
          });
          continue; // We found the word, move to next segment
      }

      // STRATEGY B: Nested timestamps (The code you had before)
      // Only run this if segment.timestamps is actually an ARRAY
      if (segment.timestamps && Array.isArray(segment.timestamps)) {
          for (const ts of segment.timestamps) {
            words.push({
              word: ts.text.trim(),
              start: ts.from / 1000,
              end: ts.to / 1000
            });
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