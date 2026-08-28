const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreview, renameCandidate, imageCandidate } = require('../public/js/tool-preview');

test('file renamer preview matches casing, separator, pattern, and extension rules', () => {
  const output = renameCandidate('Photos/My Hero.Image.JPG', 0, {
    casing: 'lowercase',
    separator: 'hyphen',
    renamePattern: '{name}_cleaned_{index}',
    strictClean: true,
    collapseHyphens: true,
    organizeByExtension: false
  }, 1);
  assert.equal(output, 'Photos/my-hero-image-cleaned-1.jpg');
});

test('file renamer preview detects and resolves bulk collisions', () => {
  const preview = buildPreview('file-renamer', [
    { path: 'a/logo.JPG' },
    { path: 'b/logo.JPG' }
  ], {
    casing: 'lowercase',
    separator: 'hyphen',
    strictClean: true,
    collapseHyphens: true,
    organizeByExtension: true
  });

  assert.deepEqual(preview.rows.map(row => row.output), [
    'JPG_Files/logo.jpg',
    'JPG_Files/logo-1.jpg'
  ]);
  assert.equal(preview.collisions, 1);
  assert.match(preview.warnings[0], /collision/i);
});

test('image converter preview changes supported image extensions', () => {
  const preview = buildPreview('image-converter', [
    { path: 'assets/Hero.PNG' },
    { path: 'assets/photo.jpg' }
  ], { targetFormat: 'webp', quality: '82', renamePattern: '{name}_prod_{index}' });

  assert.deepEqual(preview.rows.map(row => row.output), [
    'assets/Hero_prod_1.webp',
    'assets/photo_prod_2.webp'
  ]);
  assert.equal(preview.changes, 2);
  assert.equal(preview.skipped, 0);
});

test('image preview marks unsupported files as pass-through', () => {
  const result = imageCandidate('image-converter', 'assets/readme.txt', 0, { targetFormat: 'avif' });
  assert.deepEqual(result, { output: 'assets/readme.txt', skipped: true });

  const preview = buildPreview('image-converter', [{ path: 'assets/readme.txt' }], { targetFormat: 'avif' });
  assert.equal(preview.skipped, 1);
  assert.match(preview.warnings[0], /pass through unchanged/i);
});

test('preview warns about unsafe rename path separators before processing', () => {
  const preview = buildPreview('file-renamer', [{ path: 'hello.txt' }], {
    casing: 'keep', separator: 'keep', renamePattern: '../{name}', strictClean: false, collapseHyphens: false
  });
  assert.ok(preview.warnings.some(warning => /path separators/i.test(warning)));
});
