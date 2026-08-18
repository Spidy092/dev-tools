const test = require('node:test');
const assert = require('node:assert/strict');
const { safeRelativePath, normalizePaths } = require('../web/security');

test('safeRelativePath preserves normal nested paths', () => {
  assert.equal(safeRelativePath('assets/images/logo.png'), 'assets/images/logo.png');
});

test('safeRelativePath normalizes Windows separators', () => {
  assert.equal(safeRelativePath('assets\\images\\logo.png'), 'assets/images/logo.png');
});

test('safeRelativePath rejects traversal', () => {
  assert.throws(() => safeRelativePath('../secret.txt'));
  assert.throws(() => safeRelativePath('assets/../../secret.txt'));
});

test('safeRelativePath rejects absolute and drive-letter paths', () => {
  assert.throws(() => safeRelativePath('/etc/passwd'));
  assert.throws(() => safeRelativePath('C:\\Windows\\system.ini'));
});

test('normalizePaths validates paths against uploaded files', () => {
  const files = [{ originalname: 'one.txt' }, { originalname: 'two.txt' }];
  assert.deepEqual(normalizePaths(['a/one.txt', 'b/two.txt'], files), ['a/one.txt', 'b/two.txt']);
});
