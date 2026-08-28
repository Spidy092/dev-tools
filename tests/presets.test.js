const test = require('node:test');
const assert = require('node:assert/strict');
const presets = require('../public/js/tool-presets');

test('creates a normalized tool-scoped preset', () => {
  const preset = presets.createPreset('image-converter', '  Website Images  ', {
    targetFormat: 'webp', quality: '82', grayscale: false
  });
  assert.equal(preset.toolId, 'image-converter');
  assert.equal(preset.name, 'Website Images');
  assert.deepEqual(preset.options, { targetFormat: 'webp', quality: '82', grayscale: false });
  assert.match(preset.id, /^preset-/);
});

test('exported preset round-trips and stays tool-scoped', () => {
  const preset = presets.createPreset('file-renamer', 'Release names', { casing: 'lowercase', strictClean: true });
  const bundle = presets.parseBundle(presets.serializePreset(preset), 'file-renamer');
  assert.equal(bundle.version, 1);
  assert.equal(bundle.presets.length, 1);
  assert.equal(bundle.presets[0].name, 'Release names');
  assert.equal(bundle.presets[0].options.strictClean, true);
});

test('cross-tool imports are rejected', () => {
  const preset = presets.createPreset('image-converter', 'WebP', { targetFormat: 'webp' });
  assert.throws(() => presets.parseBundle(presets.serializePreset(preset), 'file-renamer'), /different tool/);
});

test('unsupported bundle versions are rejected', () => {
  assert.throws(() => presets.parseBundle(JSON.stringify({
    format: 'devtoolkit-preset', version: 99, toolId: 'image-converter', presets: []
  }), 'image-converter'), /Unsupported preset file version/);
});

test('upsert replaces same-name presets instead of creating duplicates', () => {
  const oldPreset = presets.createPreset('image-converter', 'Production', { quality: '70' });
  const nextPreset = presets.createPreset('image-converter', 'production', { quality: '85' });
  const list = presets.upsertPreset([oldPreset], nextPreset);
  assert.equal(list.length, 1);
  assert.equal(list[0].options.quality, '85');
});

test('preset values reject nested objects and oversized unsafe shapes', () => {
  assert.throws(() => presets.createPreset('image-converter', 'Bad', { targetFormat: { nested: true } }), /unsupported option value/);
  assert.throws(() => presets.createPreset('../bad', 'Bad', {}), /Invalid tool id/);
  assert.throws(() => presets.createPreset('image-converter', '', {}), /Preset name is required/);
});
