const test = require('node:test');
const assert = require('node:assert/strict');
const intel = require('../public/js/folder-intelligence');

test('classifies common developer file types', () => {
  assert.equal(intel.classify('assets/logo.webp'), 'images');
  assert.equal(intel.classify('src/app.tsx'), 'code');
  assert.equal(intel.classify('data/config.yaml'), 'data');
  assert.equal(intel.classify('docs/spec.pdf'), 'pdfs');
  assert.equal(intel.classify('release/app.zip'), 'archives');
  assert.equal(intel.classify('README.md'), 'docs');
  assert.equal(intel.classify('binary.bin'), 'other');
});

test('analyzes full project totals and common root', () => {
  const result = intel.analyze([
    { path: 'project/src/app.js', size: 1000 },
    { path: 'project/assets/logo.png', size: 2000 },
    { path: 'project/docs/spec.pdf', size: 3000 },
    { path: 'project/data/config.json', size: 4000 }
  ]);
  assert.equal(result.count, 4);
  assert.equal(result.totalBytes, 10000);
  assert.equal(result.root, 'project');
  assert.equal(result.groups.code, 1);
  assert.equal(result.groups.images, 1);
  assert.equal(result.groups.pdfs, 1);
  assert.equal(result.groups.data, 1);
  assert.equal(result.folders, 4);
});

test('returns top extensions and largest files in descending order', () => {
  const result = intel.analyze([
    { path: 'a.png', size: 10 },
    { path: 'b.png', size: 30 },
    { path: 'c.js', size: 20 }
  ]);
  assert.deepEqual(result.topExtensions[0], { extension: 'png', count: 2 });
  assert.equal(result.largest[0].path, 'b.png');
  assert.equal(result.largest[1].path, 'c.js');
});

test('large-file threshold is bounded and filterable', () => {
  assert.equal(intel.largeThreshold(0, 0), 5 * 1024 * 1024);
  const threshold = intel.largeThreshold(100 * 1024 * 1024, 10);
  assert.equal(threshold, 50 * 1024 * 1024);
  assert.equal(intel.matchesFilter({ path: 'video.bin', size: threshold }, 'large', threshold), true);
  assert.equal(intel.matchesFilter({ path: 'video.bin', size: threshold - 1 }, 'large', threshold), false);
});

test('mixed roots do not claim a single folder root', () => {
  const result = intel.analyze([
    { path: 'one/a.js', size: 1 },
    { path: 'two/b.js', size: 1 }
  ]);
  assert.equal(result.root, '');
});
