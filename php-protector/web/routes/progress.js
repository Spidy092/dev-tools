const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// In-memory store for active SSE connections
const clients = new Map();

/**
 * SSE endpoint — client connects to receive progress events for a jobId
 * GET /progress/:jobId
 */
router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;

  // Close any existing connection for this jobId to prevent leaks
  const prev = clients.get(jobId);
  if (prev) {
    prev.end();
    clients.delete(jobId);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('\n');

  clients.set(jobId, res);

  req.on('close', () => { clients.delete(jobId); });
});

/**
 * Generate a unique job ID for SSE tracking
 */
function createJobId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Send an SSE event to a connected client
 */
function sendProgress(jobId, data) {
  const client = clients.get(jobId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

/**
 * Close the SSE connection for a job
 */
function endProgress(jobId) {
  const client = clients.get(jobId);
  if (client) {
    client.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);
    client.end();
    clients.delete(jobId);
  }
}

module.exports = { router, createJobId, sendProgress, endProgress };
