// workers/cues.js

const MOOD_RELATED = {
  tense: ['urgent', 'anxious', 'suspenseful'],
  calm: ['hopeful', 'neutral', 'peaceful'],
  mysterious: ['dark', 'eerie', 'ominous'],
  joyful: ['upbeat', 'happy', 'cheerful']
};

/**
 * Calculate metadata score for a cue based on scene requirements
 */
function metaScore(cue, scene, window) {
  let score = 0;

  // Mood matching (exact match = 3 points, related = 1 point)
  if (scene.mood) {
    if (cue.mood === scene.mood) {
      score += 3;
    } else if (MOOD_RELATED[scene.mood]?.includes(cue.mood || '')) {
      score += 1;
    }
  }

  // Intensity proximity (closer = better, max 1 point)
  if (typeof scene.intensity === 'number' && typeof cue.intensity === 'number') {
    score += 1 - Math.abs((scene.intensity || 0.5) - cue.intensity);
  }

  // Loopable tracks get bonus
  if (cue.loopable) {
    score += 0.5;
  }

  // Duration fit bonus
  if ((cue.duration || 0) >= window) {
    score += 0.5;
  }

  // Penalize vocals under dialogue
  if (cue.tags?.includes('vocals')) {
    score -= 5;
  }

  // Bonus for underscore/background music
  if (cue.tags?.includes('underscore')) {
    score += 0.5;
  }

  return score;
}

/**
 * Simulate spectral analysis (audio-aware selection)
 * In production, this would analyze actual audio frequency content
 */
async function simulateSpectralAnalysis(filePath) {
  // Simulate mid-band ratio (0 = good for dialogue, 1 = mid-heavy)
  // In production, this would use FFmpeg bandpass filters
  return Math.random() * 0.3; // Simulate good-to-moderate midrange presence
}

/**
 * Pick music and ambience cues for a scene
 * Uses deterministic scoring based on metadata and simulated audio analysis
 * 
 * @param {Object} scene - Scene with mood, intensity, dialogue
 * @param {Object} catalog - Music and ambience catalogs
 * @returns {Promise<Object>} Selected cues
 */
export async function pickCues(scene, catalog) {
  const approxWindow = 60; // Approximate scene duration in seconds

  // Get music candidates sorted by metadata score
  const candidates = [...(catalog.music || [])]
    .sort((a, b) => metaScore(b, scene, approxWindow) - metaScore(a, scene, approxWindow))
    .slice(0, 8); // Top 8 candidates

  let best = null;
  let bestScore = -Infinity;

  // Analyze candidates with simulated spectral analysis
  for (const cue of candidates) {
    const midRatio = await simulateSpectralAnalysis(cue.path);
    
    // Duration fit score
    const ratio = (cue.duration || approxWindow) / approxWindow;
    const durationFit = (ratio >= 0.9 && ratio <= 1.3) ? 2 : (ratio > 0.7 ? 1 : 0);

    // Total score: metadata + spectral + duration
    const total = metaScore(cue, scene, approxWindow) + (1 - midRatio) * 2 + durationFit;

    if (total > bestScore) {
      bestScore = total;
      best = cue;
    }
  }

  // Pick first matching ambience (simple selection for beta)
  const ambience = (catalog.ambience || [])[0] 
    ? [{ cue_id: catalog.ambience[0].id }] 
    : [];

  const music = best ? [{ cue_id: best.id }] : [];

  return { music, ambience };
}