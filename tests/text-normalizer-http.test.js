const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../web/app');

async function startApp(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function formWithFile(buffer, filename, relativePath, fields = {}) {
  const form = new FormData();
  form.append('files', new Blob([buffer]), filename);
  form.append('paths', relativePath || filename);
  Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
  return form;
}

test('text normalizer converts CRLF + UTF-8 BOM to LF + plain UTF-8', async t => {
  const base = await startApp(t);
  const input = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n', 'utf8')]);
  const form = formWithFile(input, 'app.js', 'src/app.js', { lineEnding: 'lf', encodingMode: 'utf8' });
  const response = await fetch(base + '/file-tools/normalize-text', { method: 'POST', body: form });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /app\.js/i);
  const output = Buffer.from(await response.arrayBuffer());
  assert.equal(output.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
  assert.equal(output.toString('utf8'), 'one\ntwo\n');
});

test('text normalizer preserves binary single-file input byte-for-byte', async t => {
  const base = await startApp(t);
  const input = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);
  const form = formWithFile(input, 'asset.bin', 'assets/asset.bin', { lineEnding: 'lf', encodingMode: 'utf8' });
  const response = await fetch(base + '/file-tools/normalize-text', { method: 'POST', body: form });

  assert.equal(response.status, 200);
  const output = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(output, input);
});

test('text normalizer rejects unsupported configuration values', async t => {
  const base = await startApp(t);
  const form = formWithFile(Buffer.from('hello\n'), 'hello.txt', 'hello.txt', { lineEnding: 'invalid', encodingMode: 'utf8' });
  const response = await fetch(base + '/file-tools/normalize-text', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /unsupported normalization settings/i);
});
