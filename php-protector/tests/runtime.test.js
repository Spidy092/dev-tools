const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { app, readiness } = require('../web/app');

function request(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: address.port, path: pathname }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

test('app can be imported without starting its own listener', () => {
  assert.equal(typeof app.listen, 'function');
  assert.equal(typeof readiness, 'function');
});

test('readiness exposes writable runtime and job state', () => {
  const state = readiness();
  assert.equal(typeof state.ready, 'boolean');
  assert.equal(typeof state.checks.tempDirectoriesWritable, 'boolean');
  assert.equal(typeof state.jobs.active, 'number');
  assert.equal(typeof state.memory.heapUsedMb, 'number');
});

test('healthz and readyz return machine-readable JSON', async t => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const health = await request(server, '/healthz');
  assert.equal(health.status, 200);
  assert.match(String(health.headers['content-type']), /application\/json/);
  assert.equal(JSON.parse(health.body).ok, true);

  const ready = await request(server, '/readyz');
  const payload = JSON.parse(ready.body);
  assert.ok(ready.status === 200 || ready.status === 503);
  assert.equal(typeof payload.ready, 'boolean');
  assert.equal(typeof payload.jobs.active, 'number');
});

test('service worker does not cache legacy runner or server-rendered pages', async t => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const sw = await request(server, '/sw.js');
  assert.equal(sw.status, 200);
  assert.doesNotMatch(sw.body, /tool-runner\.js/);
  assert.doesNotMatch(sw.body, /virtual-tree\.js/);
  assert.match(sw.body, /request\.mode === 'navigate'/);
  assert.match(sw.body, /fetch\(request\)/);
});
