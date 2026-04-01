const dropzone = document.getElementById('dropzone');
const folderInput = document.getElementById('folder-input');
const stats = document.getElementById('stats');
const statTotal = document.getElementById('stat-total');
const statPhp = document.getElementById('stat-php');
const statOther = document.getElementById('stat-other');
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPct = document.getElementById('progress-pct');
const logWrap = document.getElementById('log-wrap');
const log = document.getElementById('log');
const downloadWrap = document.getElementById('download-wrap');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');

let zipBlob = null;

// --- Drag and drop events ---
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const items = e.dataTransfer.items;
  if (!items) return;

  // Use DataTransferItemList to get files with relative paths
  const filePromises = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry();
      if (entry) filePromises.push(readEntry(entry));
    }
  }

  Promise.all(filePromises).then((results) => {
    const files = results.flat();
    if (files.length > 0) processFiles(files);
  });
});

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

// --- Browse button (folder input) ---
folderInput.addEventListener('change', () => {
  const files = Array.from(folderInput.files);
  if (files.length > 0) processFiles(files);
});

// --- Main processing function ---
async function processFiles(files) {
  // Count PHP vs other
  let phpCount = 0;
  let otherCount = 0;
  for (const file of files) {
    if (file.name.endsWith('.php')) phpCount++;
    else otherCount++;
  }

  // Show UI
  dropzone.classList.add('hidden');
  stats.classList.remove('hidden');
  progressWrap.classList.remove('hidden');
  logWrap.classList.remove('hidden');

  statTotal.textContent = files.length;
  statPhp.textContent = phpCount;
  statOther.textContent = otherCount;

  // Log each file
  log.innerHTML = '';
  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;
    const isPhp = file.name.endsWith('.php');
    const line = document.createElement('div');
    line.className = isPhp ? 'log-php' : 'log-copy';
    line.textContent = (isPhp ? '[PHP] ' : '[COPY] ') + relativePath;
    log.appendChild(line);
  }

  // Build FormData — key is CRITICAL: filename = relative path
  const formData = new FormData();
  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;
    formData.append('files', file, relativePath);
    formData.append('paths', relativePath);
  }

  // Animate progress bar
  let progress = 0;
  const interval = setInterval(() => {
    if (progress < 85) {
      progress += Math.random() * 8;
      updateProgress(Math.min(progress, 85));
    }
  }, 200);

  progressText.textContent = 'Uploading and obfuscating...';

  try {
    const response = await fetch('/upload', {
      method: 'POST',
      body: formData,
    });

    clearInterval(interval);

    if (!response.ok) {
      throw new Error('Server error: ' + response.statusText);
    }

    // Get ZIP blob
    zipBlob = await response.blob();

    updateProgress(100);
    progressText.textContent = 'Done!';
    document.getElementById('log-dot').style.background = '#22c55e';

    // Show download
    downloadWrap.classList.remove('hidden');

  } catch (err) {
    clearInterval(interval);
    progressText.textContent = 'Error: ' + err.message;
    progressBar.style.background = '#ef4444';
  }
}

function updateProgress(pct) {
  progressBar.style.width = pct + '%';
  progressPct.textContent = Math.round(pct) + '%';
}

// --- Download button ---
downloadBtn.addEventListener('click', () => {
  if (!zipBlob) return;
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = 'protected-' + Date.now() + '.zip';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
});

// --- Reset button ---
resetBtn.addEventListener('click', () => {
  location.reload();
});
