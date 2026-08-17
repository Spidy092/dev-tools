const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const clients = new Map();
const pending = new Map();
const MAX_PENDING_EVENTS = 250;
const JOB_TTL_MS = 10 * 60 * 1000;

function writeEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function queueEvent(jobId, data) {
  const current = pending.get(jobId) || { events: [], createdAt: Date.now(), ended: false };
  current.events.push(data);
  if (current.events.length > MAX_PENDING_EVENTS) current.events.shift();
  pending.set(jobId, current);
}

function cleanupExpired() {
  const now = Date.now();
  for (const [jobId, state] of pending.entries()) {
    if (now - state.createdAt > JOB_TTL_MS) pending.delete(jobId);
  }
}
setInterval(cleanupExpired, 60 * 1000).unref();

router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!/^[a-f0-9]{16}$/.test(jobId)) return res.status(400).end();

  const previous = clients.get(jobId);
  if (previous) previous.end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  clients.set(jobId, res);

  const state = pending.get(jobId);
  if (state) {
    state.events.forEach(event => writeEvent(res, event));
    state.events = [];
    if (state.ended) {
      writeEvent(res, { event: 'done' });
      res.end();
      clients.delete(jobId);
      pending.delete(jobId);
      return;
    }
  }

  req.on('close', () => {
    if (clients.get(jobId) === res) clients.delete(jobId);
  });
});

function createJobId() {
  const jobId = crypto.randomBytes(8).toString('hex');
  pending.set(jobId, { events: [], createdAt: Date.now(), ended: false });
  return jobId;
}

function sendProgress(jobId, data) {
  const client = clients.get(jobId);
  if (client) writeEvent(client, data);
  else queueEvent(jobId, data);
}

function endProgress(jobId) {
  const client = clients.get(jobId);
  if (client) {
    writeEvent(client, { event: 'done' });
    client.end();
    clients.delete(jobId);
    pending.delete(jobId);
    return;
  }

  const state = pending.get(jobId) || { events: [], createdAt: Date.now(), ended: false };
  state.ended = true;
  pending.set(jobId, state);
}

module.exports = { router, createJobId, sendProgress, endProgress };
