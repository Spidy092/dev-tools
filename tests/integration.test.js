const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');

const { app } = require('../web/app');
const { TOOLS } = require('../web/tool-registry');
const { uploadsDir } = require('../web/multer-setup');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII=',
  'base64'
);

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

async function postForm(base, pathname, form, headers = {}) {
  return fetch(base + pathname, { method: 'POST', body: form, headers });
}

async function waitForCleanup(jobId, timeoutMs = 1000) {
  const jobPath = `${uploadsDir}/${jobId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(jobPath)) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return !fs.existsSync(jobPath);
}

test('dashboard, settings, and every registered tool render successfully', async t => {
  const base = await startApp(t);
  const paths = ['/', '/settings'].concat(TOOLS.map(tool => tool.route));

  for (const pathname of paths) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 200, `${pathname} should render`);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    assert.match(html, /DevToolkit/i);
  }
});

test('PHP Protector processes a single PHP file and returns a job id', async t => {
  const base = await startApp(t);
  const form = formWithFile(Buffer.from('<?php echo "hello";'), 'hello.php', 'src/hello.php');
  const response = await postForm(base, '/upload', form);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /hello\.php/i);
  assert.match(response.headers.get('x-job-id') || '', /^[a-f0-9]{32}$/);
  const body = await response.text();
  assert.ok(body.length > 0);
});

test('Image Resizer accepts and returns a real image', async t => {
  const base = await startApp(t);
  const form = formWithFile(PNG_1X1, 'pixel.png', 'images/pixel.png', { width: 1, height: 1, fit: 'contain' });
  const response = await postForm(base, '/image-tools/resize', form);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /image\/png/);
  assert.ok((await response.arrayBuffer()).byteLength > 0);
});

test('Image Converter converts PNG to WebP', async t => {
  const base = await startApp(t);
  const form = formWithFile(PNG_1X1, 'pixel.png', 'pixel.png', { targetFormat: 'webp', quality: 80 });
  const response = await postForm(base, '/image-tools/convert', form);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /image\/webp/);
  assert.match(response.headers.get('content-disposition') || '', /pixel\.webp/i);
  assert.ok((await response.arrayBuffer()).byteLength > 0);
});

test('Image Compressor handles a supported image and returns downloadable output', async t => {
  const base = await startApp(t);
  const form = formWithFile(PNG_1X1, 'pixel.png', 'pixel.png', { level: 'medium', targetFormat: 'keep' });
  const response = await postForm(base, '/image-compressor-tools/compress', form);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /image\/png|application\/octet-stream/);
  assert.ok((await response.arrayBuffer()).byteLength > 0);
});

test('PDF Compressor rejects non-PDF input without requiring Ghostscript', async t => {
  const base = await startApp(t);
  const form = formWithFile(Buffer.from('not a pdf'), 'notes.txt', 'notes.txt');
  const response = await postForm(base, '/pdf-tools/compress', form);

  assert.equal(response.status, 415);
  const payload = await response.json();
  assert.match(payload.error, /PDF/i);
});

test('Smart File Renamer returns the requested renamed filename', async t => {
  const base = await startApp(t);
  const form = formWithFile(Buffer.from('hello'), 'My File.TXT', 'My File.TXT', {
    casing: 'lowercase',
    separator: 'hyphen',
    strictClean: 'true',
    collapseHyphens: 'true'
  });
  const response = await postForm(base, '/file-tools/rename', form);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /my-file\.txt/i);
  assert.equal(await response.text(), 'hello');
});

test('Code Minifier minifies JavaScript content', async t => {
  const base = await startApp(t);
  const source = 'function add(a, b) { return a + b; } console.log(add(1, 2));';
  const form = formWithFile(Buffer.from(source), 'app.js', 'src/app.js', {
    minifyJs: 'true',
    mangleVariables: 'false',
    preserveComments: 'false'
  });
  const response = await postForm(base, '/minify-tools/minify', form);

  assert.equal(response.status, 200);
  const output = await response.text();
  assert.ok(output.length < source.length);
  assert.match(output, /console\.log/);
});

test('invalid archive paths are rejected and uploaded job files are cleaned immediately', async t => {
  const base = await startApp(t);
  const jobId = 'a'.repeat(32);
  const form = formWithFile(Buffer.from('sensitive'), 'secret.txt', '../secret.txt');
  const response = await postForm(base, '/file-tools/rename', form, { 'X-Job-Id': jobId });

  assert.equal(response.status, 400);
  assert.equal(await waitForCleanup(jobId), true, 'rejected upload directory should be removed');
});

test('requests with an obviously oversized Content-Length are rejected before body parsing', async t => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();

  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method: 'POST',
      path: '/upload',
      headers: { 'Content-Length': String(1024 * 1024 * 1024) }
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

  assert.equal(result.status, 413);
  assert.match(result.body, /server limit/i);
});
