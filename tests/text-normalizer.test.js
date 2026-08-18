const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detectAndDecode, detectLineEndings, normalizeBuffer, normalizeFile } = require('../core/textNormalizer');
const { ProcessingError } = require('../core/processingEngine');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolkit-text-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('detects mixed line endings and normalizes them to LF', () => {
  const input = Buffer.from('one\r\ntwo\nthree\rfour\r\n', 'utf8');
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(detectLineEndings(input.toString('utf8')), 'mixed');
  assert.equal(result.changed, true);
  assert.equal(result.skipped, false);
  assert.equal(result.output.toString('utf8'), 'one\ntwo\nthree\nfour\n');
  assert.equal(result.outputLineEnding, 'lf');
});

test('normalizes LF to CRLF without creating doubled CR characters', () => {
  const input = Buffer.from('one\ntwo\n', 'utf8');
  const result = normalizeBuffer(input, { lineEnding: 'crlf', encodingMode: 'utf8' });
  assert.equal(result.output.toString('utf8'), 'one\r\ntwo\r\n');
  assert.equal(result.outputLineEnding, 'crlf');
});

test('removes UTF-8 BOM when plain UTF-8 is requested', () => {
  const input = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello\r\n', 'utf8')]);
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.sourceEncoding, 'utf8-bom');
  assert.equal(result.outputEncoding, 'utf8');
  assert.equal(result.output.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
  assert.equal(result.output.toString('utf8'), 'hello\n');
});

test('adds UTF-8 BOM when requested', () => {
  const result = normalizeBuffer(Buffer.from('hello\n'), { lineEnding: 'lf', encodingMode: 'utf8-bom' });
  assert.equal(result.output.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), true);
  assert.equal(result.output.subarray(3).toString('utf8'), 'hello\n');
});

test('recognized UTF-16LE BOM text can be converted safely to UTF-8', () => {
  const input = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello\r\nworld', 'utf16le')]);
  const decoded = detectAndDecode(input);
  assert.equal(decoded.encoding, 'utf16le-bom');
  assert.equal(decoded.supported, true);
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.output.toString('utf8'), 'hello\nworld');
  assert.equal(result.outputEncoding, 'utf8');
});

test('recognized UTF-16BE BOM text can be converted safely to UTF-8', () => {
  const body = Buffer.from('hello\r\nworld', 'utf16le');
  body.swap16();
  const input = Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
  const decoded = detectAndDecode(input);
  assert.equal(decoded.encoding, 'utf16be-bom');
  assert.equal(decoded.supported, true);
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.output.toString('utf8'), 'hello\nworld');
});

test('malformed UTF-8 BOM payload is preserved instead of decoded lossily', () => {
  const input = Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28]);
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'unsupported-encoding');
  assert.deepEqual(result.output, input);
});

test('odd-length UTF-16 BOM payload is preserved instead of truncating a code unit', () => {
  const input = Buffer.from([0xff, 0xfe, 0x41]);
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'unsupported-encoding');
  assert.deepEqual(result.output, input);
});

test('binary data containing null bytes passes through byte-for-byte', () => {
  const input = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'binary');
  assert.equal(result.changed, false);
  assert.deepEqual(result.output, input);
});

test('invalid UTF-8 without a supported BOM is not guessed', () => {
  const input = Buffer.from([0xc3, 0x28]);
  const result = normalizeBuffer(input, { lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'unsupported-encoding');
  assert.deepEqual(result.output, input);
});

test('preserve mode leaves already consistent UTF-8 unchanged', () => {
  const input = Buffer.from('hello\nworld\n', 'utf8');
  const result = normalizeBuffer(input, { lineEnding: 'preserve', encodingMode: 'preserve' });
  assert.equal(result.changed, false);
  assert.deepEqual(result.output, input);
});

test('normalizeFile enforces a bounded memory ceiling and expected upload size', async t => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'large.txt');
  fs.writeFileSync(filePath, '0123456789');

  await assert.rejects(
    normalizeFile(filePath, { maxBytes: 5, expectedSize: 10 }),
    error => error instanceof ProcessingError && error.code === 'FILE_SIZE_LIMIT'
  );

  await assert.rejects(
    normalizeFile(filePath, { maxBytes: 20, expectedSize: 11 }),
    error => error instanceof ProcessingError && error.code === 'FILE_SIZE_MISMATCH'
  );

  const result = await normalizeFile(filePath, { maxBytes: 20, expectedSize: 10, lineEnding: 'lf', encodingMode: 'utf8' });
  assert.equal(result.inputBytes, 10);
  assert.equal(result.output.toString(), '0123456789');
});
