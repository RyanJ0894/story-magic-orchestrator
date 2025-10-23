# Story Magic Orchestrator

Audio production pipeline for Story Magic - converts Director JSON into professional-quality audio.

## Features

- AI-generated dialogue (ElevenLabs TTS)
- Context-aware timing and pacing
- Intelligent music/ambience selection
- Adaptive audio mixing with ducking
- EBU R128 loudness normalization (-16 LUFS)

## Environment Variables
```
ELEVENLABS_API_KEY=your_key_here
SUPABASE_URL=your_url_here
SUPABASE_ANON_KEY=your_key_here
PORT=3000
NODE_ENV=production
```

## Endpoints

- `GET /health` - Health check
- `POST /orchestrate` - Process Director JSON

## Deployment

Deployed on Railway with automatic GitHub integration.