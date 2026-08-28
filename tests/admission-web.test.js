const test = require('node:test');
const assert = require('node:assert/strict');
const { MiB } = require('../core/resourcePolicy');
const { kindForRequest, estimateAdmission, BASE_UNITS } = require('../web/admission');

function req(method, originalUrl) {
  return { method, originalUrl };
}

test('all processing endpoints map to an explicit admission class', () => {
  assert.equal(kindForRequest(req('POST', '/upload')), 'php');
  assert.equal(kindForRequest(req('POST', '/image-tools/resize')), 'image');
  assert.equal(kindForRequest(req('POST', '/image-tools/convert')), 'image');
  assert.equal(kindForRequest(req('POST', '/image-compressor-tools/compress')), 'image');
  assert.equal(kindForRequest(req('POST', '/pdf-tools/compress')), 'pdf');
  assert.equal(kindForRequest(req('POST', '/minify-tools/minify')), 'code');
  assert.equal(kindForRequest(req('POST', '/file-tools/checksums/generate')), 'checksum');
  assert.equal(kindForRequest(req('POST', '/file-tools/checksums/verify')), 'checksum');
  assert.equal(kindForRequest(req('POST', '/file-tools/duplicates')), 'duplicate');
  assert.equal(kindForRequest(req('POST', '/file-tools/normalize-text')), 'text');
  assert.equal(kindForRequest(req('POST', '/file-tools/rename')), 'stream');

  assert.equal(kindForRequest(req('POST', '/progress/' + 'a'.repeat(32) + '/cancel')), null);
  assert.equal(kindForRequest(req('GET', '/image-tools/resize')), null);
  assert.equal(kindForRequest(req('POST', '/unrelated')), null);
});

test('base admission units preserve relative processor cost', () => {
  assert.equal(BASE_UNITS.stream, 1);
  assert.equal(BASE_UNITS.checksum, 1);
  assert.ok(BASE_UNITS.duplicate > BASE_UNITS.checksum);
  assert.ok(BASE_UNITS.code > BASE_UNITS.text);
  assert.equal(BASE_UNITS.image, BASE_UNITS.pdf);
  assert.ok(BASE_UNITS.image > BASE_UNITS.code);
});

test('admission cost grows with declared bytes and file count', () => {
  const smallImage = estimateAdmission('image', [{ size: 5 * MiB }]);
  const largeImage = estimateAdmission('image', [{ size: 200 * MiB }]);
  assert.equal(smallImage.units, BASE_UNITS.image);
  assert.equal(largeImage.units, BASE_UNITS.image + 1);
  assert.equal(largeImage.bytes, 200 * MiB);

  const manyFiles = Array.from({ length: 3500 }, () => ({ size: 0 }));
  const fileHeavy = estimateAdmission('stream', manyFiles);
  assert.equal(fileHeavy.files, 3500);
  assert.equal(fileHeavy.units, BASE_UNITS.stream + 2);
});
