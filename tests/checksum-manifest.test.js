const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateManifest, verifyManifest, normalizeManifest, toChecksumText } = require('../core/checksumManifest');

test('generates stable SHA-256 manifest and checksum text', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devtoolkit-manifest-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const a = path.join(dir, 'a.txt'); const b = path.join(dir, 'b.txt');
  await fs.writeFile(a, 'alpha'); await fs.writeFile(b, 'beta');
  const manifest = await generateManifest([
    { filePath:b, relativePath:'src/b.txt', size:4 },
    { filePath:a, relativePath:'src/a.txt', size:5 }
  ]);
  assert.equal(manifest.files.length, 2);
  assert.deepEqual(manifest.files.map(f => f.path), ['src/a.txt', 'src/b.txt']);
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(toChecksumText(manifest), /^[a-f0-9]{64}  src\/a\.txt/m);
});

test('verification reports valid, changed, missing and new files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devtoolkit-verify-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const validPath = path.join(dir, 'valid.txt');
  const changedPath = path.join(dir, 'changed.txt');
  const missingPath = path.join(dir, 'missing.txt');
  await fs.writeFile(validPath, 'same'); await fs.writeFile(changedPath, 'old!'); await fs.writeFile(missingPath, 'gone');
  const original = await generateManifest([
    { filePath:validPath, relativePath:'valid.txt', size:4 },
    { filePath:changedPath, relativePath:'changed.txt', size:4 },
    { filePath:missingPath, relativePath:'missing.txt', size:4 }
  ]);
  await fs.writeFile(changedPath, 'new!');
  const addedPath = path.join(dir, 'added.txt'); await fs.writeFile(addedPath, 'plus');
  const report = await verifyManifest([
    { filePath:validPath, relativePath:'valid.txt', size:4 },
    { filePath:changedPath, relativePath:'changed.txt', size:4 },
    { filePath:addedPath, relativePath:'added.txt', size:4 }
  ], original);
  assert.equal(report.summary.valid, 1);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.missing, 1);
  assert.equal(report.summary.added, 1);
  assert.equal(report.summary.clean, false);
  assert.equal(report.changed[0].reason, 'checksum');
});

test('size mismatch is marked changed without requiring hash equality', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devtoolkit-size-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'file.txt'); await fs.writeFile(file, 'abc');
  const manifest = await generateManifest([{ filePath:file, relativePath:'file.txt', size:3 }]);
  await fs.writeFile(file, 'abcdef');
  const report = await verifyManifest([{ filePath:file, relativePath:'file.txt', size:6 }], manifest);
  assert.equal(report.summary.hashed, 0);
  assert.equal(report.changed[0].reason, 'size');
});

test('manifest parser rejects traversal, duplicate paths and bad hashes', () => {
  const base = { format:'devtoolkit-manifest', version:1, algorithm:'sha256' };
  assert.throws(() => normalizeManifest({ ...base, files:[{ path:'../secret', size:1, sha256:'a'.repeat(64) }] }), /invalid path/);
  assert.throws(() => normalizeManifest({ ...base, files:[{ path:'a', size:1, sha256:'a'.repeat(64) }, { path:'a', size:1, sha256:'b'.repeat(64) }] }), /duplicate file paths/);
  assert.throws(() => normalizeManifest({ ...base, files:[{ path:'a', size:1, sha256:'bad' }] }), /invalid SHA-256/);
});
