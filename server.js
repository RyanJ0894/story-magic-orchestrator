import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { orchestrate } from './workers/orchestrator.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'story-magic-orchestrator'
  });
});

// Main orchestration endpoint
app.post('/orchestrate', async (req, res) => {
  try {
    const directorJSON = req.body;

    // Validate required fields
    if (!directorJSON || !directorJSON.project_id || !directorJSON.scenes) {
      return res.status(400).json({
        error: 'Invalid Director JSON',
        message: 'Missing project_id or scenes'
      });
    }

    // TODO: Call orchestrator worker here
    // For now, return a simple response
    // Import orchestrator at the top of the file

// Then in the /orchestrate endpoint, replace the placeholder with:
try {
  console.log('🎬 Starting orchestration for project:', directorJSON.project_id);
  const result = await orchestrate(directorJSON);
  
  res.json({
    status: 'success',
    project_id: directorJSON.project_id,
    audio_urls: result.audio_urls,
    playback_manifest: result.manifest
  });
} catch (error) {
  console.error('❌ Orchestration failed:', error);
  res.status(500).json({
    status: 'error',
    message: error.message,
    project_id: directorJSON.project_id
  });
}
  } catch (error) {
    console.error('Error in /orchestrate:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Start server - FIXED: hostname comes BEFORE callback
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Story Magic Orchestrator running on port ${PORT}`);
  console.log(`📍 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📍 Orchestrate endpoint: http://0.0.0.0:${PORT}/orchestrate`);
});
// Download endpoint for testing
app.get('/download/:project_id/:filename', (req, res) => {
  const { project_id, filename } = req.params;
  const filePath = `/app/output/${project_id}/${filename}`;
  
  const fs = require('fs');
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'File not found', path: filePath });
  }
});