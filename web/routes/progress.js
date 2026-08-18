const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const clients = new Map();
const jobs = new Map();
const activeRequestKeys = new Map();

const JOB_ID_RE = /^[a-f0-9]{16,32}$/;
const REQUEST_KEY_RE = /^[a-f0-9]{16,64}$/;
const MAX_PENDING_EVENTS = Math.min(1000, Math.max(50, Number(process.env.MAX_PENDING_JOB_EVENTS) || 250));
const JOB_TTL_MS = Math.max(60_000, Number(process.env.JOB_TTL_MS) || 10 * 60 * 1000);
const JOB_TIMEOUT_MS = Math.max(10_000, Number(process.env.JOB_TIMEOUT_MS) || 5 * 60 * 1000);
const PLACEHOLDER_TTL_MS = 30_000;

class JobCancelledError extends Error {
  constructor(reason = 'cancelled') {
    super(reason === 'timeout' ? 'Processing timed out' : 'Processing cancelled');
    this.name = 'JobCancelledError';
    this.code = 'JOB_CANCELLED';
    this.reason = reason;
  }
}

function newJobId() {
  return crypto.randomBytes(16).toString('hex');
}

function terminal(status) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function createState(jobId, options = {}) {
  return {
    id: jobId,
    status: options.placeholder ? 'waiting' : 'running',
    placeholder: Boolean(options.placeholder),
    requestKey: options.requestKey || '',
    events: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ended: false,
    cancelRequested: false,
    cancelReason: '',
    controller: new AbortController(),
    timeout: null
  };
}

function stateFor(jobId) {
  return jobs.get(jobId);
}

function writeEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function queueEvent(state, data) {
  state.events.push(data);
  if (state.events.length > MAX_PENDING_EVENTS) state.events.shift();
}

function emitEvent(jobId, data) {
  const state = jobs.get(jobId);
  if (!state || state.ended) return false;
  state.updatedAt = Date.now();
  const client = clients.get(jobId);
  if (client) writeEvent(client, data);
  else queueEvent(state, data);
  return true;
}

function releaseRequestKey(state) {
  if (state.requestKey && activeRequestKeys.get(state.requestKey) === state.id) {
    activeRequestKeys.delete(state.requestKey);
  }
}

function finishJob(jobId, requestedStatus = 'completed', extra = {}) {
  const state = jobs.get(jobId);
  if (!state || state.ended) return;

  let status = requestedStatus;
  if (state.cancelRequested && status === 'completed') status = 'cancelled';

  state.status = status;
  state.ended = true;
  state.placeholder = false;
  state.updatedAt = Date.now();
  if (state.timeout) clearTimeout(state.timeout);
  releaseRequestKey(state);

  const finalEvent = {
    event: 'done',
    status,
    reason: state.cancelReason || undefined,
    ...extra
  };

  const client = clients.get(jobId);
  if (client) {
    writeEvent(client, finalEvent);
    client.end();
    clients.delete(jobId);
  } else {
    queueEvent(state, finalEvent);
  }
}

function cancelJob(jobId, reason = 'user') {
  const state = jobs.get(jobId);
  if (!state || state.ended || terminal(state.status)) return false;
  if (state.cancelRequested) return true;

  state.cancelRequested = true;
  state.cancelReason = reason;
  state.status = 'cancel_requested';
  state.updatedAt = Date.now();
  try { state.controller.abort(reason); } catch (_) {}
  emitEvent(jobId, { event: 'cancel_requested', reason });
  return true;
}

function isJobCancelled(jobId) {
  const state = jobs.get(jobId);
  return Boolean(state && state.cancelRequested);
}

function throwIfCancelled(jobId) {
  const state = jobs.get(jobId);
  if (state && state.cancelRequested) throw new JobCancelledError(state.cancelReason || 'cancelled');
}

function getJobSignal(jobId) {
  const state = jobs.get(jobId);
  return state ? state.controller.signal : undefined;
}

function getJobCounts() {
  let active = 0;
  let waiting = 0;
  let completed = 0;
  for (const state of jobs.values()) {
    if (state.placeholder && !state.ended) waiting++;
    else if (!state.ended && !terminal(state.status)) active++;
    else completed++;
  }
  return { active, waiting, retained: jobs.size, completed };
}

function cancelAllActiveJobs(reason = 'shutdown') {
  let cancelled = 0;
  for (const [jobId, state] of jobs.entries()) {
    if (state.placeholder || state.ended || terminal(state.status)) continue;
    if (cancelJob(jobId, reason)) cancelled++;
  }
  return cancelled;
}

function closeProgressClients() {
  for (const [jobId, client] of clients.entries()) {
    try { client.end(); } catch (_) {}
    clients.delete(jobId);
  }
}

function sanitizeHeader(value, re) {
  const normalized = String(value || '').trim().toLowerCase();
  return re.test(normalized) ? normalized : '';
}

function prepareJob(req, res, next) {
  const requestedJobId = String(req.get('X-Job-Id') || '').trim().toLowerCase();
  if (requestedJobId && !JOB_ID_RE.test(requestedJobId)) {
    return res.status(400).json({ error: 'Invalid job identifier.' });
  }

  const requestKeyHeader = String(req.get('X-Request-Key') || '').trim().toLowerCase();
  if (requestKeyHeader && !REQUEST_KEY_RE.test(requestKeyHeader)) {
    return res.status(400).json({ error: 'Invalid request key.' });
  }

  const jobId = requestedJobId || newJobId();
  const requestKey = sanitizeHeader(requestKeyHeader, REQUEST_KEY_RE);

  const duplicateJob = jobs.get(jobId);
  if (duplicateJob && !duplicateJob.placeholder && !duplicateJob.ended) {
    return res.status(409).json({ error: 'This job is already processing.', jobId });
  }

  if (requestKey) {
    const existingJobId = activeRequestKeys.get(requestKey);
    const existingState = existingJobId ? jobs.get(existingJobId) : null;
    if (existingState && !existingState.ended && !terminal(existingState.status)) {
      return res.status(409).json({ error: 'An identical batch is already processing.', jobId: existingJobId });
    }
    if (existingJobId) activeRequestKeys.delete(requestKey);
  }

  let state = duplicateJob;
  if (!state || state.ended) {
    state = createState(jobId, { requestKey });
    jobs.set(jobId, state);
  } else {
    state.placeholder = false;
    state.status = 'running';
    state.requestKey = requestKey;
    state.updatedAt = Date.now();
  }

  if (requestKey) activeRequestKeys.set(requestKey, jobId);
  req.jobId = jobId;
  res.setHeader('X-Job-Id', jobId);

  state.timeout = setTimeout(() => {
    if (cancelJob(jobId, 'timeout')) {
      console.warn(`[Job ${jobId}] timed out after ${JOB_TIMEOUT_MS}ms`);
    }
  }, JOB_TIMEOUT_MS);
  state.timeout.unref?.();

  let responseFinished = false;
  res.once('finish', () => {
    responseFinished = true;
    const current = jobs.get(jobId);
    if (!current || current.ended) return;
    if (res.statusCode >= 400) finishJob(jobId, current.cancelRequested ? 'cancelled' : 'failed');
    else finishJob(jobId, current.cancelRequested ? 'cancelled' : 'completed');
  });
  res.once('close', () => {
    const current = jobs.get(jobId);
    if (responseFinished || !current || current.ended) return;
    cancelJob(jobId, 'client-disconnected');
    finishJob(jobId, 'cancelled');
  });

  next();
}

router.get('/:jobId/status', (req, res) => {
  const jobId = String(req.params.jobId || '').toLowerCase();
  if (!JOB_ID_RE.test(jobId)) return res.status(400).json({ error: 'Invalid job identifier.' });
  const state = jobs.get(jobId);
  if (!state) return res.status(404).json({ error: 'Job not found.' });
  res.json({
    jobId,
    status: state.status,
    cancelRequested: state.cancelRequested,
    reason: state.cancelReason || null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  });
});

router.post('/:jobId/cancel', (req, res) => {
  const jobId = String(req.params.jobId || '').toLowerCase();
  if (!JOB_ID_RE.test(jobId)) return res.status(400).json({ error: 'Invalid job identifier.' });
  const state = jobs.get(jobId);
  if (!state) return res.status(404).json({ error: 'Job not found.' });
  if (state.ended || terminal(state.status)) {
    return res.status(409).json({ error: 'Job has already finished.', status: state.status });
  }
  cancelJob(jobId, 'user');
  res.status(202).json({ jobId, status: 'cancel_requested' });
});

router.get('/:jobId', (req, res) => {
  const jobId = String(req.params.jobId || '').toLowerCase();
  if (!JOB_ID_RE.test(jobId)) return res.status(400).end();

  let state = jobs.get(jobId);
  if (!state) {
    state = createState(jobId, { placeholder: true });
    jobs.set(jobId, state);
  }

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

  const buffered = state.events.splice(0, state.events.length);
  buffered.forEach(event => writeEvent(res, event));
  if (state.ended) {
    res.end();
    clients.delete(jobId);
    return;
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    if (clients.get(jobId) === res) clients.delete(jobId);
  });
});

function cleanupExpired() {
  const now = Date.now();
  for (const [jobId, state] of jobs.entries()) {
    const maxAge = state.placeholder ? PLACEHOLDER_TTL_MS : JOB_TTL_MS;
    if (now - state.updatedAt <= maxAge) continue;
    if (!state.ended && !state.placeholder) cancelJob(jobId, 'expired');
    if (state.timeout) clearTimeout(state.timeout);
    releaseRequestKey(state);
    const client = clients.get(jobId);
    if (client) client.end();
    clients.delete(jobId);
    jobs.delete(jobId);
  }
}
setInterval(cleanupExpired, 60_000).unref();

// Legacy helper retained for compatibility while all routes migrate to prepareJob.
function createJobId() {
  const jobId = newJobId();
  jobs.set(jobId, createState(jobId));
  return jobId;
}

function sendProgress(jobId, data) {
  return emitEvent(jobId, data);
}

function endProgress(jobId, status = 'completed', extra = {}) {
  finishJob(jobId, status, extra);
}

module.exports = {
  router,
  prepareJob,
  createJobId,
  sendProgress,
  endProgress,
  cancelJob,
  cancelAllActiveJobs,
  closeProgressClients,
  getJobCounts,
  isJobCancelled,
  throwIfCancelled,
  getJobSignal,
  JobCancelledError,
  JOB_ID_RE
};
