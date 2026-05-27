/**
 * tool-runner.js — Virtual file tree, debounced exclude, web worker filtering, SSE progress
 */
function initToolRunner() {
  const dropzone = document.getElementById('dropzone');
  let folderInput = document.getElementById('folder-input');
  const resetBtn = document.getElementById('reset-btn');
  const downloadBtn = document.getElementById('download-btn');
  const fileTreePanel = document.getElementById('file-tree-panel');
  const fileTreeEl = document.getElementById('file-tree');
  const proceedBtn = document.getElementById('proceed-btn');
  const excludeInput = document.getElementById('exclude-patterns');
  const logWrap = document.getElementById('log-wrap');
  const logEl = document.getElementById('log');

  let processedBlob = null;
  let fileName = 'processed.zip';
  let currentMode = 'bulk';
  let selectedFiles = [];
  let fileWorker = null;
  let debounceTimer = null;

  // Init web worker for filtering
  try { fileWorker = new Worker('/js/file-worker.js'); } catch (e) { /* fallback below */ }

  // Safe Toast wrapper to avoid ReferenceError if toast.js fails to load
  function safeToast(method, msg, dur) { if (typeof Toast !== 'undefined' && Toast[method]) Toast[method](msg, dur); }

  // Centralised file-input change handler (avoids duplicate listeners)
  function onFileInputChange(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) showFilePreview(files);
  }

  const originalTitle = document.querySelector('.drop-title') ? document.querySelector('.drop-title').innerText : '';
  const originalSub = document.querySelector('.drop-sub') ? document.querySelector('.drop-sub').innerText : '';

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.dataset.mode;
      // Defer input swap to avoid triggering file dialog
      setTimeout(() => {
        const parent = folderInput.parentNode;
        const newInput = document.createElement('input');
        newInput.type = 'file';
        newInput.id = 'folder-input';
        newInput.style.display = 'none';
        if (currentMode === 'bulk') {
          newInput.setAttribute('webkitdirectory', '');
        } else {
          newInput.setAttribute('multiple', '');
        }
        newInput.addEventListener('change', onFileInputChange);
        parent.replaceChild(newInput, folderInput);
        folderInput = newInput;
      }, 0);

      // Reset state and clear UI panels
      selectedFiles = [];
      processedBlob = null;
      if (fileTreeEl) fileTreeEl.innerHTML = '';
      if (logEl) logEl.innerHTML = '';
      
      if (dropzone) dropzone.classList.remove('hidden');
      if (fileTreePanel) fileTreePanel.classList.add('hidden');
      
      const statsPanel = document.getElementById('stats');
      if (statsPanel) statsPanel.classList.add('hidden');
      
      const progressWrap = document.getElementById('progress-wrap');
      if (progressWrap) progressWrap.classList.add('hidden');
      
      if (logWrap) logWrap.classList.add('hidden');
      
      const downloadWrap = document.getElementById('download-wrap');
      if (downloadWrap) downloadWrap.classList.add('hidden');
      
      const optionsPanel = document.getElementById('options-panel');
      if (optionsPanel) optionsPanel.classList.remove('hidden');
      
      const progressBar = document.getElementById('progress-bar');
      if (progressBar) progressBar.style.width = '0%';
      const progressPct = document.getElementById('progress-pct');
      if (progressPct) progressPct.textContent = '0%';

      // Update dropzone title and sub based on mode
      const title = document.querySelector('.drop-title');
      const sub = document.querySelector('.drop-sub');
      if (title) title.innerText = currentMode === 'bulk' ? originalTitle : 'Drop your files here';
      if (sub) sub.innerText = currentMode === 'bulk' ? originalSub : 'Select one or more files to process';
    });
  });

  // Single change listener on the initial input
  folderInput.addEventListener('change', onFileInputChange);

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const files = currentMode === 'bulk' ? await readDroppedFolder(e.dataTransfer.items) : Array.from(e.dataTransfer.files);
    if (files.length > 0) showFilePreview(files);
  });

  // --- Full-page drop overlay ("drop anywhere") ---
  let dragCounter = 0;
  const overlay = document.createElement('div');
  overlay.id = 'drop-overlay';
  overlay.className = 'drop-overlay hidden';
  overlay.innerHTML = '<div class="drop-overlay-content"><div class="drop-overlay-icon">📂</div><div class="drop-overlay-text">Drop anywhere to upload</div></div>';
  document.body.appendChild(overlay);

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dropzone && !dropzone.classList.contains('hidden')) {
      overlay.classList.remove('hidden');
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; overlay.classList.add('hidden'); }
  });

  document.addEventListener('dragover', (e) => e.preventDefault());

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add('hidden');
    dropzone.classList.remove('drag-over');
    if (dropzone.classList.contains('hidden')) return;
    const files = currentMode === 'bulk' ? await readDroppedFolder(e.dataTransfer.items) : Array.from(e.dataTransfer.files);
    if (files.length > 0) showFilePreview(files);
  });

  // --- File preview (count + size) before processing ---
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function showFilePreview(files) {
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const phpCount = files.filter(f => f.name.endsWith('.php')).length;

    // Show preview toast
    if (typeof Toast !== 'undefined') {
      safeToast('info', `${files.length} files (${formatSize(totalSize)}) — ${phpCount} PHP`, 3000);
    }

    // Update stat-php if visible
    const statPhp = document.getElementById('stat-php');
    if (statPhp) statPhp.innerText = phpCount;

    showFileTree(files);
  }

  // --- File Tree with Virtual Scrolling ---
  function showFileTree(files) {
    selectedFiles = files;
    if (!fileTreePanel || currentMode === 'single') {
      startProcessing(files);
      return;
    }
    dropzone.classList.add('hidden');
    if (document.getElementById('options-panel')) document.getElementById('options-panel').classList.add('hidden');
    fileTreePanel.classList.remove('hidden');

    // Init virtual tree
    if (typeof VirtualTree !== 'undefined') {
      VirtualTree.init(fileTreeEl);
    }
    renderTree(files);
  }

  function renderTree(files) {
    const excludeRaw = (excludeInput && excludeInput.value) || '';
    const patterns = excludeRaw.split(',').map(p => p.trim()).filter(Boolean);

    const fileData = files.map((f, i) => ({
      path: f.webkitRelativePath || f.name,
      name: f.name,
      idx: i
    }));

    // Use web worker if available
    if (fileWorker) {
      fileWorker.onmessage = (e) => {
        if (e.data.type === 'filtered') {
          if (typeof VirtualTree !== 'undefined') {
            VirtualTree.setItems(e.data.items);
          } else {
            renderTreeFallback(e.data.items);
          }
        }
      };
      fileWorker.postMessage({ type: 'sort-and-filter', files: fileData, patterns });
    } else {
      // Fallback: sort and filter on main thread
      const sorted = fileData.sort((a, b) => a.path.localeCompare(b.path));
      const items = sorted.map(file => {
        const ext = file.path.split('.').pop().toLowerCase();
        const excluded = matchesExclude(file.path, patterns);
        return { path: file.path, ext, excluded, checked: !excluded, idx: file.idx };
      });
      if (typeof VirtualTree !== 'undefined') {
        VirtualTree.setItems(items);
      } else {
        renderTreeFallback(items);
      }
    }
  }

  // Fallback renderer for when VirtualTree isn't loaded
  function renderTreeFallback(items) {
    let html = '';
    items.forEach(item => {
      const cls = item.excluded ? 'ft-file ft-excluded' : (item.ext === 'php' ? 'ft-file ft-php' : 'ft-file');
      html += `<div class="${cls}"><input type="checkbox" data-idx="${item.idx}" ${item.checked ? 'checked' : ''}><span>${item.path}</span></div>`;
    });
    fileTreeEl.innerHTML = html;
  }

  function matchesExclude(filePath, patterns) {
    return patterns.some(pat => {
      const regex = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return regex.test(filePath) || regex.test(filePath.split('/').pop());
    });
  }

  // Debounced exclude pattern input (300ms)
  if (excludeInput) {
    excludeInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (selectedFiles.length) renderTree(selectedFiles);
      }, 300);
    });
  }

  if (proceedBtn) {
    proceedBtn.addEventListener('click', () => {
      let indices;
      if (typeof VirtualTree !== 'undefined') {
        indices = VirtualTree.getCheckedIndices();
      } else {
        const checkboxes = fileTreeEl.querySelectorAll('input[type=checkbox]:checked');
        indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx));
      }
      const filtered = indices.map(i => selectedFiles[i]);
      if (filtered.length === 0) { safeToast('error', 'No files selected'); return; }
      fileTreePanel.classList.add('hidden');
      startProcessing(filtered);
    });
  }

  // --- Processing with SSE ---
  async function startProcessing(files) {
    if (!files || files.length === 0) return;
    dropzone.classList.add('hidden');
    if (document.getElementById('options-panel')) document.getElementById('options-panel').classList.add('hidden');

    const statsEl = document.getElementById('stats');
    const progressWrap = document.getElementById('progress-wrap');
    statsEl.classList.remove('hidden');
    progressWrap.classList.remove('hidden');
    if (logWrap) logWrap.classList.remove('hidden');

    document.getElementById('stat-total').innerText = files.length;
    const statDone = document.getElementById('stat-done');
    if (statDone) statDone.innerText = '0';

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
      formData.append('paths', files[i].webkitRelativePath || files[i].name);
    }

    // Collect form inputs
    document.querySelectorAll('#options-panel input, #options-panel select').forEach(input => {
      if (input.type === 'file') return;
      if (input.type === 'checkbox') formData.append(input.id, input.checked);
      else if (input.id && input.id !== 'exclude-patterns') formData.append(input.id, input.value);
    });

    const endpoint = window.toolEndpoint || '/upload';

    try {
      const response = await fetch(endpoint, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(`Server error (${response.status})`);

      const jobId = response.headers.get('X-Job-Id');
      if (jobId) connectSSE(jobId, files.length);

      const contentDisp = response.headers.get('content-disposition');
      if (contentDisp && contentDisp.includes('filename=')) {
        fileName = contentDisp.split('filename=')[1].replace(/"/g, '');
      }

      processedBlob = await response.blob();
      showComplete();
      safeToast('success', `${files.length} files processed successfully!`);
    } catch (err) {
      safeToast('error', 'Processing failed: ' + err.message);
      const retryBtn = document.createElement('button');
      retryBtn.className = 'reset-btn';
      retryBtn.textContent = 'Retry';
      retryBtn.style.marginTop = '12px';
      retryBtn.onclick = () => location.reload();
      dropzone.classList.remove('hidden');
      dropzone.parentNode.insertBefore(retryBtn, dropzone.nextSibling);
    }
  }

  function connectSSE(jobId, totalFiles) {
    const evtSource = new EventSource(`/progress/${jobId}`);
    let processed = 0;

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.event === 'done') { evtSource.close(); return; }
      processed++;
      const pct = Math.round((processed / totalFiles) * 100);
      updateProgress(pct);

      const statDone = document.getElementById('stat-done');
      if (statDone) statDone.innerText = processed;

      const progressText = document.getElementById('progress-text');
      if (progressText) progressText.innerText = data.file || 'Processing...';

      if (logEl && data.file) {
        const cls = data.type === 'php' ? 'log-php' : 'log-copy';
        logEl.innerHTML += `<div class="${cls}">[${data.type === 'php' ? 'PHP' : 'COPY'}] ${data.file}</div>`;
        logEl.scrollTop = logEl.scrollHeight;
      }
    };

    evtSource.onerror = () => evtSource.close();
  }

  function showComplete() {
    document.getElementById('progress-wrap').classList.add('hidden');
    document.getElementById('download-wrap').classList.remove('hidden');
    document.getElementById('progress-bar').style.width = '100%';
    if (logWrap) {
      const dot = logWrap.querySelector('.log-dot');
      if (dot) { dot.style.animation = 'none'; dot.style.background = '#22c55e'; }
    }
  }

  downloadBtn.addEventListener('click', () => {
    if (!processedBlob) return;
    const url = URL.createObjectURL(processedBlob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    safeToast('info', 'Download started');
  });

  resetBtn.addEventListener('click', () => location.reload());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initToolRunner);
} else {
  initToolRunner();
}
