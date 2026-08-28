const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const {
  normalizeArchivePath,
  validateEntries,
  writeZip
} = require('../core/archiveEngine');

function collector() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  stream.output = () => Buffer.concat(chunks);
  return stream;
}

test('rejects traversal, absolute, control, reserved and non-portable archive paths', () => {
  const bad = [
    '../secret.txt',
    '/etc/passwd',
    'C:/secret.txt',
    'folder/../secret.txt',
    'folder/NUL.txt',
    'folder/COM1',
    'folder/name?.txt',
    'folder/trailing. ',
    `folder/bad${String.fromCharCode(1)}.txt`
  ];
  for (const value of bad) {
    assert.throws(() => normalizeArchivePath(value), error => Boolean(error?.code));
  }
});

test('normalizes separators but rejects duplicate and case-insensitive collisions', () => {
  assert.equal(normalizeArchivePath('src\\nested\\app.js'), 'src/nested/app.js');
  assert.throws(() => validateEntries([
    { name: 'a.txt', buffer: Buffer.from('a') },
    { name: 'a.txt', buffer: Buffer.from('b') }
  ]), error => error?.code === 'DUPLICATE_ARCHIVE_PATH');
  assert.throws(() => validateEntries([
    { name: 'Readme.md', buffer: Buffer.from('a') },
    { name: 'README.md', buffer: Buffer.from('b') }
  ]), error => error?.code === 'PORTABLE_ARCHIVE_COLLISION');
});

test('can opt out of portable case folding for explicitly platform-specific archives', () => {
  const entries = validateEntries([
    { name: 'Readme.md', buffer: Buffer.from('a') },
    { name: 'README.md', buffer: Buffer.from('b') }
  ], { portable: false });
  assert.equal(entries.length, 2);
});

test('enforces declared archive byte and entry budgets before streaming', () => {
  assert.throws(() => validateEntries([
    { name: 'a.txt', size: 5, buffer: Buffer.from('a') },
    { name: 'b.txt', size: 6, buffer: Buffer.from('b') }
  ], { maxTotalBytes: 10 }), error => error?.code === 'ARCHIVE_SIZE_LIMIT');

  assert.throws(() => validateEntries([
    { name: 'a.txt', buffer: Buffer.from('a') },
    { name: 'b.txt', buffer: Buffer.from('b') }
  ], { maxEntries: 1 }), error => error?.code === 'TOO_MANY_ARCHIVE_ENTRIES');
});

test('writes deterministic ZIP bytes for deterministic entries', async () => {
  const entries = [
    { name: 'a.txt', buffer: Buffer.from('alpha') },
    { name: 'folder/b.txt', buffer: Buffer.from('beta') }
  ];
  const first = collector();
  const second = collector();
  await writeZip(first, entries, { level: 6, maxBufferBytes: 1024 });
  await writeZip(second, entries, { level: 6, maxBufferBytes: 1024 });
  const a = first.output();
  const b = second.output();
  assert.ok(a.length > 20);
  assert.equal(a.subarray(0, 2).toString('ascii'), 'PK');
  assert.deepEqual(a, b);
});

test('enforces buffer ceilings for lazy transformed entries', async () => {
  const destination = collector();
  await assert.rejects(
    writeZip(destination, [{
      name: 'large.txt',
      open: async () => Buffer.alloc(32)
    }], { maxBufferBytes: 16 }),
    error => error?.code === 'ARCHIVE_BUFFER_LIMIT'
  );
});

test('streams regular files lazily with expected-size verification', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolkit-archive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'source.txt');
  fs.writeFileSync(filePath, 'hello world');

  let completed = 0;
  const destination = collector();
  await writeZip(destination, [{
    name: 'source.txt',
    filePath,
    size: 11
  }], {
    onEntryComplete: ({ outputBytes }) => {
      completed++;
      assert.equal(outputBytes, 11);
    }
  });
  assert.equal(completed, 1);
  assert.equal(destination.output().subarray(0, 2).toString('ascii'), 'PK');
});

test('fails closed when a streamed file no longer matches declared size', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolkit-archive-size-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'source.txt');
  fs.writeFileSync(filePath, 'changed');
  const destination = collector();

  await assert.rejects(
    writeZip(destination, [{ name: 'source.txt', filePath, size: 3 }]),
    error => error?.code === 'FILE_SIZE_MISMATCH'
  );
});

test('honors cancellation before archive work begins', async () => {
  const controller = new AbortController();
  controller.abort('test');
  const destination = collector();
  await assert.rejects(
    writeZip(destination, [{ name: 'a.txt', buffer: Buffer.from('a') }], { signal: controller.signal }),
    error => error?.code === 'PROCESSING_ABORTED'
  );
});
