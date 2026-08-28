const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  ProcessingError,
  normalizeConcurrency,
  normalizeChunkBytes,
  validateFileItems,
  hashFile,
  readFileBuffer,
  fingerprintFile,
  mapLimit
} = require('../core/processingEngine');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolkit-engine-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('normalizes concurrency and chunk sizes to bounded enterprise limits', () => {
  assert.equal(normalizeConcurrency(0), 1);
  assert.equal(normalizeConcurrency(999), 8);
  assert.equal(normalizeChunkBytes(1), 64 * 1024);
  assert.equal(normalizeChunkBytes(999 * 1024 * 1024), 8 * 1024 * 1024);
});

test('validateFileItems rejects duplicate logical paths and declared total-size overflow', () => {
  assert.throws(() => validateFileItems([
    { filePath: '/tmp/a', relativePath: 'same.txt', size: 1 },
    { filePath: '/tmp/b', relativePath: 'same.txt', size: 1 }
  ], { requireUniquePaths: true }), error => error instanceof ProcessingError && error.code === 'DUPLICATE_PATH');

  assert.throws(() => validateFileItems([
    { filePath: '/tmp/a', relativePath: 'a.txt', size: 6 },
    { filePath: '/tmp/b', relativePath: 'b.txt', size: 6 }
  ], { maxTotalBytes: 10 }), error => error instanceof ProcessingError && error.code === 'TOTAL_SIZE_LIMIT');
});

test('hashFile returns exact SHA-256 and verifies expected file size', async t => {
  const dir = tempDir(t);
  const content = Buffer.from('enterprise-core');
  const filePath = write(dir, 'data.bin', content);
  const result = await hashFile(filePath, { expectedSize: content.length, chunkBytes: 64 * 1024 });
  assert.equal(result.hash, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(result.bytes, content.length);

  await assert.rejects(
    hashFile(filePath, { expectedSize: content.length + 1 }),
    error => error instanceof ProcessingError && error.code === 'FILE_SIZE_MISMATCH'
  );
});

test('hashFile rejects a final-path symbolic link where the platform supports O_NOFOLLOW', async t => {
  if (typeof fs.constants.O_NOFOLLOW !== 'number') return t.skip('O_NOFOLLOW not available on this platform');
  const dir = tempDir(t);
  const real = write(dir, 'real.txt', 'secret');
  const link = path.join(dir, 'link.txt');
  try { fs.symlinkSync(real, link); } catch (error) { return t.skip(`symlink unavailable: ${error.code || error.message}`); }

  await assert.rejects(
    hashFile(link),
    error => error instanceof ProcessingError && (error.code === 'SYMLINK_REJECTED' || error.code === 'FILE_OPEN_FAILED')
  );
});

test('hashFile detects a file that changes during the read', async t => {
  const dir = tempDir(t);
  const content = Buffer.alloc(512 * 1024, 0x61);
  const filePath = write(dir, 'mutable.bin', content);
  let mutated = false;

  await assert.rejects(
    hashFile(filePath, {
      expectedSize: content.length,
      chunkBytes: 64 * 1024,
      onBytes: ({ position }) => {
        if (!mutated && position >= 64 * 1024) {
          mutated = true;
          fs.appendFileSync(filePath, Buffer.from('changed'));
        }
      }
    }),
    error => error instanceof ProcessingError && error.code === 'FILE_CHANGED_DURING_READ'
  );
});

test('hashFile cooperatively stops when cancellation is requested', async t => {
  const dir = tempDir(t);
  const filePath = write(dir, 'cancel.bin', Buffer.alloc(512 * 1024, 0x62));
  let checks = 0;
  await assert.rejects(
    hashFile(filePath, {
      chunkBytes: 64 * 1024,
      checkCancelled: () => {
        checks++;
        if (checks >= 4) throw new Error('cancelled-by-test');
      }
    }),
    /cancelled-by-test/
  );
});

test('readFileBuffer requires and enforces an explicit memory ceiling', async t => {
  const dir = tempDir(t);
  const filePath = write(dir, 'buffer.txt', '0123456789');
  await assert.rejects(
    readFileBuffer(filePath),
    error => error instanceof ProcessingError && error.code === 'BUFFER_LIMIT_REQUIRED'
  );
  await assert.rejects(
    readFileBuffer(filePath, { maxBytes: 5 }),
    error => error instanceof ProcessingError && error.code === 'FILE_SIZE_LIMIT'
  );
  const result = await readFileBuffer(filePath, { maxBytes: 10, expectedSize: 10 });
  assert.equal(result.buffer.toString(), '0123456789');
});

test('fingerprint samples large files without claiming an exact content hash', async t => {
  const dir = tempDir(t);
  const filePath = write(dir, 'large.bin', Buffer.alloc(512 * 1024, 0x63));
  const result = await fingerprintFile(filePath, { expectedSize: 512 * 1024, sampleBytes: 64 * 1024 });
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.sampledBytes, 128 * 1024);
  assert.ok(result.sampledBytes < result.stat.size);
});

test('mapLimit caps active work and preserves input result ordering', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 12 }, (_, index) => index);
  const results = await mapLimit(items, async value => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, value % 3));
    active--;
    return value * 2;
  }, { concurrency: 3 });

  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
  assert.deepEqual(results, items.map(value => value * 2));
});

test('mapLimit stops scheduling new work after the first worker failure', async () => {
  let started = 0;
  await assert.rejects(
    mapLimit([0, 1, 2, 3, 4, 5], async value => {
      started++;
      if (value === 1) throw new Error('boom');
      await new Promise(resolve => setTimeout(resolve, 5));
      return value;
    }, { concurrency: 2 }),
    /boom/
  );
  assert.ok(started < 6, `expected fail-fast scheduling, started ${started}`);
});
