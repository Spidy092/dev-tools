const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodeUtf8 } = require('../core/textCodec');
const { totalDeclaredBytes, RESOURCE_POLICY } = require('../core/resourcePolicy');
const { walkDir } = require('../core/utils');
const { assertSeparateTrees, obfuscateBuffer } = require('../core/obfuscator');

test('strict UTF-8 decoder accepts BOM and rejects malformed/binary input', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello')]);
  assert.equal(decodeUtf8(bom), 'hello');
  assert.throws(() => decodeUtf8(Buffer.from([0xc3, 0x28])), error => error?.code === 'TEXT_INVALID_UTF8');
  assert.throws(() => decodeUtf8(Buffer.from([0x61, 0x00, 0x62])), error => error?.code === 'TEXT_BINARY_INPUT');
  assert.throws(() => decodeUtf8(Buffer.from([0xff, 0xfe, 0x61, 0x00])), error => error?.code === 'TEXT_UNSUPPORTED_ENCODING');
});

test('PHP obfuscation rejects invalid UTF-8 instead of corrupting source', () => {
  assert.throws(() => obfuscateBuffer(Buffer.from([0xc3, 0x28])), error => error?.code === 'PHP_INVALID_UTF8');
  const output = obfuscateBuffer(Buffer.from('<?php echo "ok";'));
  assert.match(output.toString('utf8'), /^<\?php eval\(base64_decode\('/);
});

test('resource policy rejects unsafe declared totals', () => {
  assert.equal(totalDeclaredBytes([{ size: 3 }, { size: 4 }], 10), 7);
  assert.throws(() => totalDeclaredBytes([{ size: 6 }, { size: 6 }], 10), error => error?.code === 'CORE_BATCH_LIMIT');
  assert.throws(() => totalDeclaredBytes([{ size: -1 }], 10), RangeError);
  assert.ok(RESOURCE_POLICY.codeBufferBytes < RESOURCE_POLICY.imageBufferBytes);
});

test('folder walker is deterministic, bounded and ignores symlinks', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolkit-walk-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'b'));
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'b', '2.txt'), '2');
  fs.writeFileSync(path.join(root, 'a', '1.txt'), '1');
  try { fs.symlinkSync(path.join(root, 'a', '1.txt'), path.join(root, 'link.txt')); } catch (_) {}

  const files = await walkDir(root, root, { maxFiles: 10, maxDirectories: 10, maxDepth: 10 });
  assert.deepEqual(files.map(file => file.relativePath.split(path.sep).join('/')), ['a/1.txt', 'b/2.txt']);
  await assert.rejects(walkDir(root, root, { maxFiles: 1, maxDirectories: 10, maxDepth: 10 }), error => error?.code === 'TOO_MANY_FILES');
});

test('CLI output tree cannot equal or live inside the input tree', () => {
  assert.throws(() => assertSeparateTrees('/tmp/project', '/tmp/project'), error => error?.code === 'OUTPUT_INSIDE_INPUT');
  assert.throws(() => assertSeparateTrees('/tmp/project', '/tmp/project/dist'), error => error?.code === 'OUTPUT_INSIDE_INPUT');
  assert.doesNotThrow(() => assertSeparateTrees('/tmp/project', '/tmp/project-protected'));
});
