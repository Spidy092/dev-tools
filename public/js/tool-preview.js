/* DevToolkit dry-run preview engine. Pure functions are exported for browser and Node tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DevToolkitPreview = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var SUPPORTED_IMAGES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.gif', '.avif']);

  function bool(value) { return value === true || value === 'true' || value === 'on'; }
  function normalize(pathname) { return String(pathname || 'file').replace(/\\/g, '/').replace(/^\.\//, ''); }
  function basename(pathname) { var p = normalize(pathname); var i = p.lastIndexOf('/'); return i === -1 ? p : p.slice(i + 1); }
  function dirname(pathname) { var p = normalize(pathname); var i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); }
  function join(dir, file) { return dir ? dir.replace(/\/+$/, '') + '/' + file : file; }
  function parse(pathname) {
    var p = normalize(pathname); var file = basename(p); var dir = dirname(p); var dot = file.lastIndexOf('.');
    var hasExt = dot > 0;
    return { dir: dir, base: file, name: hasExt ? file.slice(0, dot) : file, ext: hasExt ? file.slice(dot) : '' };
  }
  function patternName(pattern, original, index) { return String(pattern || '').replace(/{name}/g, original).replace(/{index}/g, index + 1); }
  function makeUnique(candidate, used) {
    var finalPath = candidate; var counter = 1;
    while (used.has(finalPath)) { var p = parse(candidate); finalPath = join(p.dir, p.name + '-' + counter + p.ext); counter++; }
    used.add(finalPath); return finalPath;
  }
  function sanitizeRenameName(name, options) {
    var base = String(name || 'file');
    if (options.casing === 'lowercase') base = base.toLowerCase();
    else if (options.casing === 'uppercase') base = base.toUpperCase();
    var sepChar = options.separator === 'hyphen' ? '-' : options.separator === 'underscore' ? '_' : options.separator === 'none' ? '' : null;
    if (sepChar !== null) base = base.replace(/[.\s]/g, sepChar);
    if (bool(options.strictClean)) {
      var allowed = sepChar === '-' ? /[^a-zA-Z0-9-]/g : sepChar === '_' ? /[^a-zA-Z0-9_]/g : /[^a-zA-Z0-9]/g;
      base = base.replace(allowed, '');
    }
    if (bool(options.collapseHyphens)) {
      if (sepChar === '-') base = base.replace(/-+/g, '-');
      if (sepChar === '_') base = base.replace(/_+/g, '_');
    }
    return base || 'file';
  }
  function renameCandidate(pathname, index, options, total) {
    var source = bool(options.organizeByExtension) && total > 1 ? basename(pathname) : normalize(pathname);
    var p = parse(source);
    var patterned = options.renamePattern ? patternName(options.renamePattern, p.name, index) : p.name;
    var newName = sanitizeRenameName(patterned, options);
    var ext = p.ext;
    if (options.casing === 'lowercase') ext = ext.toLowerCase();
    else if (options.casing === 'uppercase') ext = ext.toUpperCase();
    var finalPath = join(p.dir, newName + ext);
    if (bool(options.organizeByExtension)) {
      var extName = ext.replace('.', '').toUpperCase();
      var folder = extName ? extName + '_Files' : 'Other_Files';
      finalPath = join(folder, finalPath);
    }
    return finalPath;
  }
  function imageCandidate(toolId, pathname, index, options) {
    var p = parse(pathname); var ext = p.ext.toLowerCase();
    if (!SUPPORTED_IMAGES.has(ext)) return { output: normalize(pathname), skipped: true };
    if (toolId === 'image-converter') {
      var target = String(options.targetFormat || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
      var name = options.renamePattern ? patternName(options.renamePattern, p.name, index) : p.name;
      return { output: join(p.dir, name + '.' + target), skipped: false };
    }
    if (toolId === 'image-resizer' && options.renamePattern) return { output: join(p.dir, patternName(options.renamePattern, p.name, index) + p.ext), skipped: false };
    return { output: normalize(pathname), skipped: false };
  }
  function operationSummary(toolId, options) {
    if (toolId === 'file-renamer') return 'Apply naming rules and package renamed results';
    if (toolId === 'duplicate-finder') return 'Read-only scan: group files by size, then SHA-256 hash only likely duplicate candidates';
    if (toolId === 'image-converter') return 'Convert supported images to ' + String(options.targetFormat || 'webp').toUpperCase() + (options.quality ? ' at quality ' + options.quality : '');
    if (toolId === 'image-resizer') return 'Resize supported images to ' + (options.width || 'auto') + ' × ' + (options.height || 'auto') + ' using ' + (options.fit || 'cover') + ' fit';
    if (toolId === 'image-compressor') return 'Compress supported images using the selected quality/format settings';
    if (toolId === 'pdf-compressor') return 'Compress selected PDFs using the chosen Ghostscript preset';
    if (toolId === 'code-minifier') return 'Minify supported HTML, CSS, and JavaScript files while preserving project paths';
    if (toolId === 'php-protector') return 'Obfuscate PHP files while preserving the project structure';
    return 'Process the selected files using the current tool settings';
  }
  function buildPreview(toolId, entries, options) {
    entries = Array.isArray(entries) ? entries : []; options = options || {};
    var used = new Set(); var collisions = 0; var skipped = 0; var changes = 0; var warnings = [];
    if (options.renamePattern && /[\\/]/.test(options.renamePattern)) warnings.push('Rename patterns containing path separators may be rejected for safety.');
    if (toolId === 'duplicate-finder') warnings.push('This scan is read-only. DevToolkit will report exact duplicates but will not delete files.');
    var rows = entries.map(function (entry, index) {
      var input = normalize(entry.path || entry.name || 'file'); var output = input; var rowSkipped = false;
      if (toolId === 'file-renamer') output = renameCandidate(input, index, options, entries.length);
      else if (toolId === 'image-converter' || toolId === 'image-resizer') { var image = imageCandidate(toolId, input, index, options); output = image.output; rowSkipped = image.skipped; }
      if (toolId === 'file-renamer' || toolId === 'image-converter' || toolId === 'image-resizer') {
        var unique = makeUnique(output, used); if (unique !== output) { collisions++; output = unique; }
      }
      if (rowSkipped) skipped++; if (output !== input) changes++;
      return { input: input, output: output, changed: output !== input, skipped: rowSkipped, size: entry.size || 0 };
    });
    if (collisions) warnings.push(collisions + ' naming collision' + (collisions === 1 ? '' : 's') + ' will be resolved with numeric suffixes.');
    if (skipped) warnings.push(skipped + ' unsupported image file' + (skipped === 1 ? ' will' : 's will') + ' pass through unchanged.');
    return { summary: operationSummary(toolId, options), rows: rows, selected: rows.length, changes: changes, collisions: collisions, skipped: skipped, warnings: warnings };
  }
  return { buildPreview: buildPreview, renameCandidate: renameCandidate, imageCandidate: imageCandidate, sanitizeRenameName: sanitizeRenameName, parse: parse };
});
