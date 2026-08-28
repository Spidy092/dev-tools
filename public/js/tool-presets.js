/* DevToolkit preset model. Pure functions are usable in browser and Node tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DevToolkitPresets = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var VERSION = 1;
  var MAX_PRESETS = 50;
  var MAX_NAME_LENGTH = 80;
  var MAX_OPTION_FIELDS = 100;
  var MAX_STRING_VALUE = 2000;

  function cleanToolId(value) {
    var toolId = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(toolId)) throw new Error('Invalid tool id.');
    return toolId;
  }

  function cleanName(value) {
    var name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Preset name is required.');
    if (name.length > MAX_NAME_LENGTH) throw new Error('Preset name is too long.');
    return name;
  }

  function cleanOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Preset options must be an object.');
    var keys = Object.keys(options);
    if (keys.length > MAX_OPTION_FIELDS) throw new Error('Preset contains too many option fields.');
    var cleaned = {};
    keys.forEach(function (key) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key)) throw new Error('Preset contains an invalid option key.');
      var value = options[key];
      if (typeof value === 'boolean' || typeof value === 'number') cleaned[key] = value;
      else if (typeof value === 'string') {
        if (value.length > MAX_STRING_VALUE) throw new Error('Preset option value is too long.');
        cleaned[key] = value;
      } else if (value == null) cleaned[key] = '';
      else throw new Error('Preset contains an unsupported option value.');
    });
    return cleaned;
  }

  function makeId() {
    return 'preset-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function createPreset(toolId, name, options, existingId) {
    return {
      id: existingId && /^preset-[a-z0-9-]{3,80}$/i.test(existingId) ? existingId : makeId(),
      toolId: cleanToolId(toolId),
      name: cleanName(name),
      options: cleanOptions(options),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizePreset(value, expectedToolId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preset.');
    var toolId = cleanToolId(value.toolId);
    if (expectedToolId && toolId !== cleanToolId(expectedToolId)) throw new Error('Preset belongs to a different tool.');
    return createPreset(toolId, value.name, value.options, value.id);
  }

  function normalizeList(values, expectedToolId) {
    if (!Array.isArray(values)) throw new Error('Preset collection must be an array.');
    if (values.length > MAX_PRESETS) throw new Error('Too many presets in one collection.');
    var byName = new Map();
    values.forEach(function (value) {
      var preset = normalizePreset(value, expectedToolId);
      byName.set(preset.name.toLowerCase(), preset);
    });
    return Array.from(byName.values()).slice(0, MAX_PRESETS);
  }

  function storageKey(toolId) {
    return 'devtoolkit_presets_v1:' + cleanToolId(toolId);
  }

  function serializePreset(preset) {
    var normalized = normalizePreset(preset, preset && preset.toolId);
    return JSON.stringify({
      format: 'devtoolkit-preset',
      version: VERSION,
      toolId: normalized.toolId,
      presets: [normalized]
    }, null, 2);
  }

  function serializeCollection(toolId, presets) {
    var normalizedTool = cleanToolId(toolId);
    var normalized = normalizeList(presets, normalizedTool);
    return JSON.stringify({ format: 'devtoolkit-preset', version: VERSION, toolId: normalizedTool, presets: normalized }, null, 2);
  }

  function parseBundle(text, expectedToolId) {
    var parsed;
    try { parsed = JSON.parse(String(text || '')); }
    catch (_error) { throw new Error('Preset file is not valid JSON.'); }
    if (!parsed || parsed.format !== 'devtoolkit-preset') throw new Error('Not a DevToolkit preset file.');
    if (parsed.version !== VERSION) throw new Error('Unsupported preset file version.');
    var toolId = cleanToolId(parsed.toolId);
    if (expectedToolId && toolId !== cleanToolId(expectedToolId)) throw new Error('Preset file belongs to a different tool.');
    return { version: VERSION, toolId: toolId, presets: normalizeList(parsed.presets || [], toolId) };
  }

  function upsertPreset(presets, preset) {
    var list = normalizeList(presets || [], preset.toolId);
    var normalized = normalizePreset(preset, preset.toolId);
    var lower = normalized.name.toLowerCase();
    var filtered = list.filter(function (item) { return item.id !== normalized.id && item.name.toLowerCase() !== lower; });
    filtered.unshift(normalized);
    return filtered.slice(0, MAX_PRESETS);
  }

  return {
    VERSION: VERSION,
    MAX_PRESETS: MAX_PRESETS,
    createPreset: createPreset,
    normalizePreset: normalizePreset,
    normalizeList: normalizeList,
    storageKey: storageKey,
    serializePreset: serializePreset,
    serializeCollection: serializeCollection,
    parseBundle: parseBundle,
    upsertPreset: upsertPreset
  };
});
