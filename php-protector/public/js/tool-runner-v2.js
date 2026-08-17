/**
 * DevToolkit shared processing workspace.
 * Selection is review-first: choosing files never starts processing automatically.
 * User-controlled filenames are rendered with textContent only.
 */
(function() {
  function initToolRunner() {
    var dropzone = document.getElementById('dropzone');
    var folderInput = document.getElementById('folder-input');
    var resetBtn = document.getElementById('reset-btn');
    var downloadBtn = document.getElementById('download-btn');
    var fileTreePanel = document.getElementById('file-tree-panel');
    var fileTreeEl = document.getElementById('file-tree');
    var proceedBtn = document.getElementById('proceed-btn');
    var excludeInput = document.getElementById('exclude-patterns');
    var logWrap = document.getElementById('log-wrap');
    var logEl = document.getElementById('log');

    if (!dropzone || !folderInput) return;

    var processedBlob = null;
    var fileName = 'processed.zip';
    var currentMode = 'bulk';
    var selectedFiles = [];
    var visibleItems = [];
    var debounceTimer = null;
    var objectUrl = null;

    var originalTitleEl = dropzone.querySelector('.drop-title');
    var originalSubEl = dropzone.querySelector('.drop-sub');
    var originalTitle = originalTitleEl ? originalTitleEl.textContent : 'Drop your folder here';
    var originalSub = originalSubEl ? originalSubEl.textContent : '';

    function toast(method, message, duration) {
      if (typeof Toast !== 'undefined' && Toast[method]) Toast[method](message, duration);
    }

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function setHidden(id, hidden) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', hidden);
    }

    function resetPanels(keepOptions) {
      processedBlob = null;
      selectedFiles = [];
      visibleItems = [];
      if (fileTreeEl) fileTreeEl.replaceChildren();
      if (logEl) logEl.replaceChildren();
      dropzone.classList.remove('hidden', 'drag-over');
      if (fileTreePanel) fileTreePanel.classList.add('hidden');
      setHidden('stats', true);
      setHidden('progress-wrap', true);
      setHidden('log-wrap', true);
      setHidden('download-wrap', true);
      var optionsPanel = document.getElementById('options-panel');
      if (optionsPanel) optionsPanel.classList.toggle('hidden', !keepOptions);
      if (typeof updateProgress === 'function') updateProgress(0);
    }

    function configureInput(mode) {
      currentMode = mode === 'bulk' ? 'bulk' : 'files';
      var parent = folderInput.parentNode;
      var replacement = document.createElement('input');
      replacement.type = 'file';
      replacement.id = 'folder-input';
      replacement.hidden = true;
      if (currentMode === 'bulk') replacement.setAttribute('webkitdirectory', '');
      else replacement.multiple = true;
      replacement.addEventListener('change', onFileInputChange);
      parent.replaceChild(replacement, folderInput);
      folderInput = replacement;

      if (originalTitleEl) originalTitleEl.textContent = currentMode === 'bulk' ? originalTitle : 'Drop files here';
      if (originalSubEl) originalSubEl.textContent = currentMode === 'bulk' ? originalSub : 'Choose one file or many files, review them, then process.';
      resetPanels(true);
    }

    document.querySelectorAll('.mode-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.mode-tab').forEach(function(other) { other.classList.remove('active'); });
        tab.classList.add('active');
        configureInput(tab.dataset.mode);
      });
    });

    function onFileInputChange(event) {
      var files = Array.from(event.target.files || []);
      if (files.length) showReview(files);
    }
    folderInput.addEventListener('change', onFileInputChange);

    function filePath(file) {
      return file.webkitRelativePath || file.name;
    }

    function parsePatterns(raw) {
      return String(raw || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
    }

    function wildcardMatch(value, pattern) {
      var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      try { return new RegExp('^' + escaped + '$').test(value); }
      catch (_error) { return false; }
    }

    function isExcluded(pathValue, patterns) {
      var basename = pathValue.split('/').pop();
      return patterns.some(function(pattern) {
        return wildcardMatch(pathValue, pattern) || wildcardMatch(basename, pattern);
      });
    }

    function buildItems(files) {
      var patterns = parsePatterns(excludeInput && excludeInput.value);
      visibleItems = files.map(function(file, index) {
        var pathname = filePath(file);
        var excluded = isExcluded(pathname, patterns);
        var extParts = pathname.split('.');
        return {
          path: pathname,
          ext: extParts.length > 1 ? extParts.pop().toLowerCase() : '',
          excluded: excluded,
          checked: !excluded,
          idx: index
        };
      }).sort(function(a, b) { return a.path.localeCompare(b.path); });
    }

    function renderReview() {
      buildItems(selectedFiles);
      if (!fileTreeEl) return;

      if (typeof VirtualTree !== 'undefined') {
        VirtualTree.init(fileTreeEl);
        VirtualTree.setItems(visibleItems);
        return;
      }

      fileTreeEl.replaceChildren();
      var fragment = document.createDocumentFragment();
      visibleItems.forEach(function(item) {
        var row = document.createElement('div');
        row.className = item.excluded ? 'ft-file ft-excluded' : item.ext === 'php' ? 'ft-file ft-php' : 'ft-file';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.checked;
        checkbox.dataset.fileIndex = String(item.idx);

        var label = document.createElement('span');
        label.textContent = item.path;

        row.appendChild(checkbox);
        row.appendChild(label);
        fragment.appendChild(row);
      });
      fileTreeEl.appendChild(fragment);
    }

    function showReview(files) {
      selectedFiles = files;
      var totalSize = files.reduce(function(total, file) { return total + (file.size || 0); }, 0);
      toast('info', files.length + ' file' + (files.length === 1 ? '' : 's') + ' selected · ' + formatSize(totalSize), 3200);

      var statPhp = document.getElementById('stat-php');
      if (statPhp) statPhp.textContent = files.filter(function(file) { return /\.php$/i.test(file.name); }).length;

      dropzone.classList.add('hidden');
      var optionsPanel = document.getElementById('options-panel');
      if (optionsPanel) optionsPanel.classList.add('hidden');
      if (fileTreePanel) fileTreePanel.classList.remove('hidden');
      renderReview();
    }

    if (excludeInput) {
      excludeInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          if (selectedFiles.length) renderReview();
        }, 200);
      });
    }

    function selectedForProcessing() {
      if (typeof VirtualTree !== 'undefined' && fileTreeEl && fileTreeEl.firstChild) {
        return VirtualTree.getCheckedIndices().map(function(index) { return selectedFiles[index]; }).filter(Boolean);
      }

      if (!fileTreeEl) return selectedFiles.slice();
      return Array.from(fileTreeEl.querySelectorAll('input[type="checkbox"]:checked'))
        .map(function(cb) { return selectedFiles[Number(cb.dataset.fileIndex)]; })
        .filter(Boolean);
    }

    if (proceedBtn) {
      proceedBtn.addEventListener('click', function() {
        var files = selectedForProcessing();
        if (!files.length) return toast('error', 'Select at least one file to process.');
        startProcessing(files);
      });
    }

    async function droppedFiles(event) {
      if (currentMode === 'bulk' && typeof readDroppedFolder === 'function') {
        return readDroppedFolder(event.dataTransfer.items);
      }
      return Array.from(event.dataTransfer.files || []);
    }

    dropzone.addEventListener('dragover', function(event) {
      event.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', function() { dropzone.classList.remove('drag-over'); });
    dropzone.addEventListener('drop', async function(event) {
      event.preventDefault();
      dropzone.classList.remove('drag-over');
      var files = await droppedFiles(event);
      if (files.length) showReview(files);
    });

    var overlay = document.createElement('div');
    overlay.className = 'drop-overlay hidden';
    var overlayContent = document.createElement('div');
    overlayContent.className = 'drop-overlay-content';
    var overlayIcon = document.createElement('div');
    overlayIcon.className = 'drop-overlay-icon';
    overlayIcon.textContent = '📂';
    var overlayText = document.createElement('div');
    overlayText.className = 'drop-overlay-text';
    overlayText.textContent = 'Drop to add files';
    overlayContent.append(overlayIcon, overlayText);
    overlay.appendChild(overlayContent);
    document.body.appendChild(overlay);

    var dragDepth = 0;
    document.addEventListener('dragenter', function(event) {
      event.preventDefault();
      dragDepth++;
      if (!dropzone.classList.contains('hidden')) overlay.classList.remove('hidden');
    });
    document.addEventListener('dragleave', function(event) {
      event.preventDefault();
      dragDepth--;
      if (dragDepth <= 0) {
        dragDepth = 0;
        overlay.classList.add('hidden');
      }
    });
    document.addEventListener('dragover', function(event) { event.preventDefault(); });
    document.addEventListener('drop', function() {
      dragDepth = 0;
      overlay.classList.add('hidden');
    });

    function collectOptions(formData) {
      document.querySelectorAll('#options-panel input, #options-panel select').forEach(function(input) {
        if (!input.id || input.type === 'file' || input.id === 'exclude-patterns' || input.disabled) return;
        if (input.type === 'checkbox') formData.append(input.id, String(input.checked));
        else formData.append(input.id, input.value);
      });
    }

    function appendLog(data) {
      if (!logEl || !data.file) return;
      var row = document.createElement('div');
      row.className = data.type === 'php' ? 'log-php' : data.type === 'compress' ? 'log-compress' : data.type === 'skip' ? 'log-skip' : 'log-copy';
      var label = data.type === 'php' ? 'PHP' : data.type === 'compress' ? 'COMP' : data.type === 'skip' ? 'SKIP' : 'FILE';
      var message = '[' + label + '] ' + data.file;
      if (typeof data.originalSize === 'number' && typeof data.compressedSize === 'number') {
        message += ' (' + formatSize(data.originalSize) + ' → ' + formatSize(data.compressedSize) + ')';
      }
      row.textContent = message;
      logEl.appendChild(row);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function connectProgress(jobId, totalFiles) {
      if (!jobId) return;
      var source = new EventSource('/progress/' + encodeURIComponent(jobId));
      var processed = 0;
      var originalBytes = 0;
      var outputBytes = 0;

      source.onmessage = function(event) {
        var data;
        try { data = JSON.parse(event.data); } catch (_error) { return; }
        if (data.event === 'done') {
          source.close();
          return;
        }

        processed++;
        if (typeof updateProgress === 'function') updateProgress(Math.min(100, processed / Math.max(totalFiles, 1) * 100));

        var done = document.getElementById('stat-done');
        if (done) done.textContent = String(processed);

        if (typeof data.originalSize === 'number' && typeof data.compressedSize === 'number') {
          originalBytes += data.originalSize;
          outputBytes += data.compressedSize;
          var saved = document.getElementById('stat-saved');
          if (saved && originalBytes > 0) saved.textContent = Math.max(0, Math.round((originalBytes - outputBytes) / originalBytes * 100)) + '%';
        }

        var progressText = document.getElementById('progress-text');
        if (progressText) progressText.textContent = data.file || 'Processing…';
        appendLog(data);
      };

      source.onerror = function() { source.close(); };
    }

    async function startProcessing(files) {
      if (!files.length) return;
      if (fileTreePanel) fileTreePanel.classList.add('hidden');
      setHidden('stats', false);
      setHidden('progress-wrap', false);
      if (logWrap) logWrap.classList.remove('hidden');

      var total = document.getElementById('stat-total');
      var done = document.getElementById('stat-done');
      var saved = document.getElementById('stat-saved');
      if (total) total.textContent = String(files.length);
      if (done) done.textContent = '0';
      if (saved) saved.textContent = '0%';

      var formData = new FormData();
      files.forEach(function(file) {
        formData.append('files', file);
        formData.append('paths', filePath(file));
      });
      collectOptions(formData);

      try {
        var response = await fetch(window.toolEndpoint || '/upload', { method: 'POST', body: formData });
        if (!response.ok) {
          var errorText = await response.text();
          throw new Error(errorText && errorText.length < 180 ? errorText : 'Server error (' + response.status + ')');
        }

        connectProgress(response.headers.get('X-Job-Id'), files.length);

        var disposition = response.headers.get('content-disposition') || '';
        var filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
        if (filenameMatch) fileName = filenameMatch[1];

        processedBlob = await response.blob();
        showComplete();
        toast('success', files.length + ' file' + (files.length === 1 ? '' : 's') + ' processed successfully.');
      } catch (error) {
        console.error(error);
        toast('error', 'Processing failed: ' + error.message, 5000);
        if (fileTreePanel) fileTreePanel.classList.remove('hidden');
        setHidden('progress-wrap', true);
      }
    }

    function showComplete() {
      setHidden('progress-wrap', true);
      setHidden('download-wrap', false);
      if (typeof updateProgress === 'function') updateProgress(100);
      if (logWrap) {
        var dot = logWrap.querySelector('.log-dot');
        if (dot) {
          dot.style.animation = 'none';
          dot.style.background = 'var(--success)';
        }
      }
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', function() {
        if (!processedBlob) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(processedBlob);
        var link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast('info', 'Download started.');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        resetPanels(true);
        folderInput.value = '';
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initToolRunner);
  else initToolRunner();
})();
