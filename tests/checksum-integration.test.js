const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../web/app');

async function startApp(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function projectForm(entries, fields = {}) {
  const form = new FormData();
  entries.forEach(entry => {
    form.append('files', new Blob([Buffer.from(entry.content)]), entry.name);
    form.append('paths', entry.path);
  });
  Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
  return form;
}

test('checksum API generates a manifest and verifies project differences', async t => {
  const base = await startApp(t);
  const originalFiles = [
    { name:'a.txt', path:'src/a.txt', content:'alpha' },
    { name:'b.txt', path:'src/b.txt', content:'beta' }
  ];
  const generated = await fetch(base + '/file-tools/checksums/generate', { method:'POST', body:projectForm(originalFiles, { outputFormat:'json' }) });
  assert.equal(generated.status, 200);
  assert.match(generated.headers.get('content-disposition') || '', /manifest\.json/);
  const manifest = await generated.json();
  assert.equal(manifest.files.length, 2);
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);

  const currentFiles = [
    { name:'a.txt', path:'src/a.txt', content:'alpha' },
    { name:'b.txt', path:'src/b.txt', content:'BETA' },
    { name:'c.txt', path:'src/c.txt', content:'new' }
  ];
  const verified = await fetch(base + '/file-tools/checksums/verify', { method:'POST', body:projectForm(currentFiles, { manifestJson:JSON.stringify(manifest) }) });
  assert.equal(verified.status, 200);
  const report = await verified.json();
  assert.equal(report.summary.valid, 1);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.missing, 0);
  assert.equal(report.summary.added, 1);
  assert.equal(report.summary.clean, false);
});

test('checksum API can emit standard sha256 text', async t => {
  const base = await startApp(t);
  const response = await fetch(base + '/file-tools/checksums/generate', {
    method:'POST',
    body:projectForm([{ name:'readme.txt', path:'readme.txt', content:'hello' }], { outputFormat:'sha256' })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /checksums\.sha256/);
  assert.match(await response.text(), /^[a-f0-9]{64}  readme\.txt\n$/);
});
