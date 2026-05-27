/**
 * Web Worker for reading file entries off the main thread.
 * Since FileSystemEntry API isn't available in workers, this worker
 * handles the heavy sorting/filtering of file lists instead.
 */
self.onmessage = function(e) {
  const { type, files, patterns } = e.data;

  if (type === 'sort-and-filter') {
    // files = [{path, name, idx}], patterns = string[]
    const sorted = files.sort((a, b) => a.path.localeCompare(b.path));
    const results = sorted.map(file => {
      const ext = file.path.split('.').pop().toLowerCase();
      const excluded = matchesExclude(file.path, patterns);
      return { path: file.path, ext, excluded, checked: !excluded, idx: file.idx };
    });
    self.postMessage({ type: 'filtered', items: results });
  }
};

function matchesExclude(filePath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some(pat => {
    const regex = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(filePath) || regex.test(filePath.split('/').pop());
  });
}
