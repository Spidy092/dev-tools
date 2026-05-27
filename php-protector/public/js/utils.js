/**
 * Shared JS utilities for folder handling and uploading.
 */

// Recursively read a filesystem entry (file or directory)
function readEntry(entry, basePath = '') {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        // Attach relative path
        Object.defineProperty(file, 'webkitRelativePath', {
          value: basePath ? `${basePath}/${entry.name}` : entry.name,
          writable: false,
        });
        resolve([file]);
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = (acc) => {
        reader.readEntries((entries) => {
          if (entries.length === 0) {
            Promise.all(
              acc.map((e) =>
                readEntry(e, basePath ? `${basePath}/${entry.name}` : entry.name)
              )
            ).then((results) => resolve(results.flat()));
          } else {
            readAll([...acc, ...entries]);
          }
        });
      };
      readAll([]);
    }
  });
}

// Read dropped folder via DataTransfer API
async function readDroppedFolder(items) {
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  const results = await Promise.all(entries.map(e => readEntry(e)));
  return results.flat();
}

// Global UI utility for updating progress
function updateProgress(pct) {
  const progressBar = document.getElementById('progress-bar');
  const progressPct = document.getElementById('progress-pct');
  if (progressBar) progressBar.style.width = pct + '%';
  if (progressPct) progressPct.textContent = Math.round(pct) + '%';
}
