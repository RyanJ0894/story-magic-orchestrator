import { z } from 'zod';

// Dialogue line schema
export const DialogueLine = z.object({
  line_id: z.string(),
  voice_key: z.string(),
  character: z.string(),
  text: z.string().min(1)
});

// Scene schema
export const Scene = z.object({
  scene_id: z.string(),
  summary: z.string().optional(),
  mood: z.string().optional(),
  intensity: z.number().min(0).max(1).optional(),
  dialogue: z.array(DialogueLine),
  ambience: z.array(z.object({
    track_id: z.string(),
    volume: z.number().min(0).max(1).optional(),
    fade_in: z.number(), 
    fade_out: z.number(), 
  })).optional(),
  music: z.array(z.object({
    track_id: z.string(),
    volume: z.number().min(0).max(1).optional(),
    fade_in: z.number(), 
    fade_out: z.number(), 
  })).optional(),
  sfx: z.array(z.object({
    cue_id: z.string(),
    track_id: z.string(),
    volume: z.number().min(0).max(1).optional(),
    at: z.number(),
  })).optional(),
  mix: z.object({ 
    target_lufs: z.number().default(-16), 
    true_peak_db: z.number().default(-1) 
  }).partial().optional(),
});

// Director JSON schema (main input format)
export const DirectorJSON = z.object({
  project_id: z.string(),
  script_id: z.string().optional(),
  scenes: z.array(Scene)
});

// Alignment schema (timing data)
export const Alignment = z.object({
  scene_id: z.string(),
  lines: z.array(z.object({
    line_id: z.string(),
    start: z.number(),
    end: z.number(),
    words: z.array(z.object({ 
      w: z.string(), 
      s: z.number(), 
      e: z.number() 
    })).optional()
  }))
});

// Timeline schema (event sequencing)
export const Timeline = z.object({
  scene_id: z.string(),
  events: z.array(z.union([
    z.object({ 
      type: z.literal('dialogue_in'), 
      line_id: z.string(), 
      at: z.number() 
    }),
    z.object({ 
      type: z.literal('dialogue_out'), 
      line_id: z.string(), 
      at: z.number() 
    }),
    z.object({ 
      type: z.literal('ambience_in'), 
      cue_id: z.string(), 
      at: z.number(), 
      fade: z.number().default(1.5), 
      gain_db: z.number().default(-18) 
    }),
    z.object({ 
      type: z.literal('ambience_out'), 
      cue_id: z.string(), 
      at: z.number(), 
      fade: z.number().default(1.5) 
    }),
    z.object({ 
      type: z.literal('music_in'), 
      cue_id: z.string(), 
      at: z.number(), 
      fade: z.number().default(1), 
      gain_db: z.number().default(-12), 
      duck_db: z.number().default(7) 
    }),
    z.object({ 
      type: z.literal('music_out'), 
      cue_id: z.string(), 
      at: z.number(), 
      fade: z.number().default(2) 
    }),
    z.object({ 
      type: z.literal('sfx_at'), 
      cue_id: z.string(), 
      at: z.number(), 
      gain_db: z.number().default(-6) 
    })
  ]))
});

// Mix manifest schema (render metadata)
export const MixManifest = z.object({
  scene_id: z.string(),
  inputs: z.object({
    dialogue: z.array(z.object({ 
      line_id: z.string(), 
      path: z.string() 
    })),
    music: z.array(z.object({ 
      cue_id: z.string(), 
      path: z.string(), 
      gain_db: z.number() 
    })),
    ambience: z.array(z.object({ 
      cue_id: z.string(), 
      path: z.string(), 
      gain_db: z.number() 
    })),
    sfx: z.array(z.object({ 
      cue_id: z.string(), 
      path: z.string(), 
      gain_db: z.number() 
    })).optional()
  }),
  lufs_i: z.number().optional(),
  true_peak_db: z.number().optional(),
  filters: z.array(z.string())
});