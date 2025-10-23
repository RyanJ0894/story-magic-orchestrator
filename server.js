import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

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
    res.json({
      status: 'received',
      project_id: directorJSON.project_id,
      scene_count: directorJSON.scenes.length,
      message: 'Orchestration pipeline will be implemented'
    });

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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Story Magic Orchestrator running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🎬 Orchestrate endpoint: http://localhost:${PORT}/orchestrate`);
});