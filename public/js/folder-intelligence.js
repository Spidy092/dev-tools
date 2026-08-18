/* DevToolkit folder intelligence engine. Pure functions for browser UI and Node tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DevToolkitFolderIntelligence = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var GROUPS = Object.freeze({
    images: new Set(['jpg','jpeg','png','webp','avif','gif','svg','ico','bmp','tif','tiff']),
    code: new Set(['js','mjs','cjs','ts','tsx','jsx','html','htm','css','scss','sass','less','php','py','rb','go','rs','java','kt','kts','c','h','cpp','hpp','cs','sh','bash','zsh','sql','vue','svelte']),
    data: new Set(['json','jsonl','yaml','yml','xml','csv','tsv','toml','ini','env']),
    pdfs: new Set(['pdf']),
    archives: new Set(['zip','tar','gz','tgz','bz2','xz','7z','rar']),
    docs: new Set(['md','mdx','txt','rtf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp'])
  });

  function normalizePath(value) { return String(value || 'file').replace(/\\/g, '/').replace(/^\.\//, ''); }
  function extension(pathname) {
    var base = normalizePath(pathname).split('/').pop() || '';
    var dot = base.lastIndexOf('.');
    return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
  }
  function classify(pathname) {
    var ext = extension(pathname);
    if (GROUPS.images.has(ext)) return 'images';
    if (GROUPS.code.has(ext)) return 'code';
    if (GROUPS.data.has(ext)) return 'data';
    if (GROUPS.pdfs.has(ext)) return 'pdfs';
    if (GROUPS.archives.has(ext)) return 'archives';
    if (GROUPS.docs.has(ext)) return 'docs';
    return 'other';
  }
  function commonRoot(entries) {
    if (!entries.length) return '';
    var split = entries.map(function (entry) { return normalizePath(entry.path).split('/'); });
    if (!split.every(function (parts) { return parts.length > 1; })) return '';
    var root = split[0][0];
    return split.every(function (parts) { return parts[0] === root; }) ? root : '';
  }
  function largeThreshold(totalBytes, count) {
    if (!count) return 5 * 1024 * 1024;
    var average = totalBytes / count;
    return Math.max(5 * 1024 * 1024, Math.min(50 * 1024 * 1024, average * 5));
  }
  function analyze(entries) {
    entries = (Array.isArray(entries) ? entries : []).map(function (entry) {
      return { path: normalizePath(entry.path || entry.name), size: Math.max(0, Number(entry.size) || 0) };
    });
    var totalBytes = entries.reduce(function (sum, entry) { return sum + entry.size; }, 0);
    var threshold = largeThreshold(totalBytes, entries.length);
    var groups = { images:0, code:0, data:0, pdfs:0, archives:0, docs:0, other:0 };
    var extensions = Object.create(null);
    var folderNames = new Set();
    entries.forEach(function (entry) {
      groups[classify(entry.path)]++;
      var ext = extension(entry.path) || '(no extension)'; extensions[ext] = (extensions[ext] || 0) + 1;
      var parts = entry.path.split('/'); if (parts.length > 1) folderNames.add(parts.slice(0, -1).join('/'));
    });
    var largest = entries.slice().sort(function (a, b) { return b.size - a.size || a.path.localeCompare(b.path); }).slice(0, 5);
    var large = entries.filter(function (entry) { return entry.size >= threshold; }).sort(function (a, b) { return b.size - a.size; });
    var topExtensions = Object.keys(extensions).map(function (ext) { return { extension:ext, count:extensions[ext] }; })
      .sort(function (a, b) { return b.count - a.count || a.extension.localeCompare(b.extension); }).slice(0, 8);
    return {
      count: entries.length,
      totalBytes: totalBytes,
      folders: folderNames.size,
      root: commonRoot(entries),
      groups: groups,
      largest: largest,
      large: large,
      largeThreshold: threshold,
      topExtensions: topExtensions
    };
  }
  function matchesFilter(entry, filter, threshold) {
    filter = String(filter || 'all');
    if (filter === 'all') return true;
    if (filter === 'large') return (Number(entry.size) || 0) >= (Number(threshold) || 5 * 1024 * 1024);
    return classify(entry.path || entry.name) === filter;
  }
  return { GROUPS:GROUPS, extension:extension, classify:classify, analyze:analyze, matchesFilter:matchesFilter, largeThreshold:largeThreshold };
});
