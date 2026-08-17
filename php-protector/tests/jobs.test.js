const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const {
  router: progressRouter,
  prepareJob,
  throwIfCancelled,
  endProgress,
  getJobCounts,
  JobCancelledError
} = require('../web/routes/progress');

function startServer(t) {
  const app = express();
  app.use('/progress', progressRouter);
  app.post('/slow', prepareJob, async (req, res) => {
    try {
      await new Promise(resolve => setTimeout(resolve, 120));
      throwIfCancelled(req.jobId);
      endProgress(req.jobId, 'completed');
      res.json({ ok: true, jobId: req.jobId });
    } catch (error) {
      if (error instanceof JobCancelledError) {
        endProgress(req.jobId, 'cancelled');
        return res.status(499).json({ error: error.message });
      }
      endProgress(req.jobId, 'failed');
      res.status(500).json({ error: 'failed' });
    }
  });

  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return new Promise(resolve => server.once('listening', () => resolve({
    server,
    base: `http://127.0.0.1:${server.address().port}`
  })));
}

function rawPost(baseUrl, pathname, headers = {}) {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('duplicate active job id is rejected with 409', async t => {
  const { base } = await startServer(t);
  const jobId = '1'.repeat(32);
  const first = rawPost(base, '/slow', { 'X-Job-Id': jobId, 'X-Request-Key': '2'.repeat(32) });
  await new Promise(resolve => setTimeout(resolve, 20));

  const duplicate = await rawPost(base, '/slow', { 'X-Job-Id': jobId, 'X-Request-Key': '3'.repeat(32) });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body, /already processing/i);

  const original = await first;
  assert.equal(original.status, 200);
});

test('duplicate active request key is rejected even with a different job id', async t => {
  const { base } = await startServer(t);
  const requestKey = '4'.repeat(32);
  const first = rawPost(base, '/slow', { 'X-Job-Id': '5'.repeat(32), 'X-Request-Key': requestKey });
  await new Promise(resolve => setTimeout(resolve, 20));

  const duplicate = await rawPost(base, '/slow', { 'X-Job-Id': '6'.repeat(32), 'X-Request-Key': requestKey });
  assert.equal(duplicate.status, 409);
  const payload = JSON.parse(duplicate.body);
  assert.equal(payload.jobId, '5'.repeat(32));

  const original = await first;
  assert.equal(original.status, 200);
});

test('active job can be cancelled through progress endpoint and reports cancelled state', async t => {
  const { base } = await startServer(t);
  const jobId = '7'.repeat(32);
  const processing = rawPost(base, '/slow', { 'X-Job-Id': jobId, 'X-Request-Key': '8'.repeat(32) });
  await new Promise(resolve => setTimeout(resolve, 20));

  const cancel = await fetch(`${base}/progress/${jobId}/cancel`, { method: 'POST' });
  assert.equal(cancel.status, 202);
  assert.equal((await cancel.json()).status, 'cancel_requested');

  const result = await processing;
  assert.equal(result.status, 499);

  const status = await fetch(`${base}/progress/${jobId}/status`);
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(payload.status, 'cancelled');
  assert.equal(payload.cancelRequested, true);
});

test('job counters expose active and retained lifecycle state', async t => {
  const { base } = await startServer(t);
  const before = getJobCounts();
  assert.equal(typeof before.active, 'number');
  assert.equal(typeof before.retained, 'number');

  const processing = rawPost(base, '/slow', { 'X-Job-Id': '9'.repeat(32), 'X-Request-Key': 'a'.repeat(32) });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(getJobCounts().active >= 1);
  await processing;
});
