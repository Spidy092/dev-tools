/**
 * DevToolkit shared batch workspace.
 * Add files/folders -> review/search/select -> configure -> process -> results/download.
 */
(function () {
  function initToolRunner() {
    var dropzone = document.getElementById('dropzone');
    var filesInput = document.getElementById('files-input');
    var folderInput = document.getElementById('folder-input');
    var queueFilesInput = document.getElementById('queue-files-input');
    var queueFolderInput = document.getElementById('queue-folder-input');
    var queuePanel = document.getElementById('file-tree-panel');
    var queueBody = document.getElementById('file-tree');
    var queueSearch = document.getElementById('queue-search');
    var queueEmpty = document.getElementById('queue-empty');
    var queueSummary = document.getElementById('queue-summary');
    var queueSelectedCount = document.getElementById('queue-selected-count');
    var queueSelectedSize = document.getElementById('queue-selected-size');
    var overflowNote = document.getElementById('queue-overflow-note');
    var excludeInput = document.getElementById('exclude-patterns');
    var selectAllBtn = document.getElementById('select-all-btn');
    var deselectAllBtn = document.getElementById('deselect-all-btn');
    var removeSelectedBtn = document.getElementById('remove-selected-btn');
    var proceedBtn = document.getElementById('proceed-btn');
    var resetBtn = document.getElementById('reset-btn');
    var downloadBtn = document.getElementById('download-btn');
    var retryFailedBtn = document.getElementById('retry-failed-btn');
    var reviewQueueBtn = document.getElementById('review-queue-btn');
    var resultsPanel = document.getElementById('results-panel');
    var resultsBody = document.getElementById('results-body');
    var resultsSubtitle = document.getElementById('results-subtitle');
    var resultsState = document.getElementById('results-state');
    var logWrap = document.getElementById('log-wrap');
    var logEl = document.getElementById('log');

    if (!dropzone || !filesInput || !folderInput || !queueBody || !proceedBtn) return;

    var queue = [];
    var processedBlob = null;
    var downloadName = 'processed.zip';
    var objectUrl = null;
    var debounceTimer = null;
    var MAX_RENDERED_ROWS = 500;

    function toast(method, message, duration) {
      if (typeof Toast !== 'undefined' && Toast[method]) Toast[method](message, duration);
    }

    function formatSize(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—';
      if (bytes === 0) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function filePath(file) {
      return String(file.webkitRelativePath || file.name || 'file').replace(/\\/g, '/');
    }

    function entryKey(file) {
      return [filePath(file), file.size || 0, file.lastModified || 0].join('::');
    }

    function parsePatterns(raw) {
      return String(raw || '').split(',').map(function (value) { return value.trim(); }).filter(Boolean);
    }

    function wildcardMatch(value, pattern) {
      var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      try { return new RegExp('^' + escaped + '$', 'i').test(value); }
      catch (_error) { return false; }
    }

    function excludedByPattern(pathname) {
      var patterns = parsePatterns(excludeInput && excludeInput.value);
      var basename = pathname.split('/').pop();
      return patterns.some(function (pattern) {
        return wildcardMatch(pathname, pattern) || wildcardMatch(basename, pattern);
      });
    }

    function isVisible(entry) {
      var query = String(queueSearch && queueSearch.value || '').trim().toLowerCase();
      return !query || entry.path.toLowerCase().indexOf(query) !== -1;
    }

    function effectiveSelected(entry) {
      return entry.selected && entry.status !== 'excluded';
    }

    function visibleEntries() { return queue.filter(isVisible); }
    function selectedEntries() { return queue.filter(effectiveSelected); }

    function syncExcludedStates() {
      queue.forEach(function (entry) {
        if (entry.status === 'processing' || entry.status === 'done' || entry.status === 'failed') return;
        entry.status = excludedByPattern(entry.path) ? 'excluded' : 'ready';
      });
    }

    function clearEntryResult(entry) {
      entry.resultStatus = null;
      entry.originalSize = null;
      entry.outputSize = null;
      entry.reduction = null;
      entry.errorMessage = null;
    }

    function addFiles(files) {
      var existing = new Set(queue.map(function (entry) { return entry.key; }));
      var added = 0;
      Array.from(files || []).forEach(function (file) {
        var key = entryKey(file);
        if (existing.has(key)) return;
        existing.add(key);
        queue.push({ key:key, file:file, path:filePath(file), size:file.size || 0, selected:true, status:'ready', resultStatus:null });
        added++;
      });
      syncExcludedStates();
      queue.sort(function (a, b) { return a.path.localeCompare(b.path); });
      if (added) toast('info', added + ' file' + (added === 1 ? '' : 's') + ' added to the queue.');
      renderQueue();
    }

    function statusLabel(status) {
      if (status === 'excluded') return 'Excluded';
      if (status === 'processing') return 'Processing';
      if (status === 'done') return 'Done';
      if (status === 'failed') return 'Failed';
      return 'Ready';
    }

    function updateSummary() {
      var selected = selectedEntries().filter(function (entry) { return entry.status === 'ready'; });
      var selectedSize = selected.reduce(function (sum, entry) { return sum + entry.size; }, 0);
      var totalSize = queue.reduce(function (sum, entry) { return sum + entry.size; }, 0);
      var excludedCount = queue.filter(function (entry) { return entry.status === 'excluded'; }).length;
      if (queueSummary) queueSummary.textContent = queue.length + ' file' + (queue.length === 1 ? '' : 's') + ' · ' + formatSize(totalSize) + (excludedCount ? ' · ' + excludedCount + ' excluded' : '');
      if (queueSelectedCount) queueSelectedCount.textContent = selected.length + ' selected';
      if (queueSelectedSize) queueSelectedSize.textContent = formatSize(selectedSize);
      proceedBtn.disabled = selected.length === 0;
      proceedBtn.textContent = (window.toolProcessLabel || 'Process Files') + ' (' + selected.length + ')';
      var statPhp = document.getElementById('stat-php');
      if (statPhp) statPhp.textContent = String(selected.filter(function (entry) { return /\.php$/i.test(entry.path); }).length);
    }

    function createQueueRow(entry) {
      var row = document.createElement('div');
      row.className = 'queue-row'; row.setAttribute('role', 'row'); row.dataset.key = entry.key;
      var checkCell = document.createElement('div'); checkCell.className = 'queue-check';
      var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = effectiveSelected(entry);
      checkbox.disabled = entry.status === 'excluded' || entry.status === 'processing' || entry.status === 'done';
      checkbox.setAttribute('aria-label', 'Select ' + entry.path);
      checkbox.addEventListener('change', function () { entry.selected = checkbox.checked; updateSummary(); });
      checkCell.appendChild(checkbox);
      var fileCell = document.createElement('div'); fileCell.className = 'queue-file';
      var name = document.createElement('strong'); name.textContent = entry.path.split('/').pop();
      var path = document.createElement('span'); path.textContent = entry.path; fileCell.append(name, path);
      var sizeCell = document.createElement('div'); sizeCell.className = 'queue-size'; sizeCell.textContent = formatSize(entry.size);
      var statusCell = document.createElement('div'); statusCell.className = 'queue-status';
      var badge = document.createElement('span'); badge.className = 'queue-status-badge status-' + entry.status; badge.textContent = statusLabel(entry.status); statusCell.appendChild(badge);
      var removeCell = document.createElement('div'); removeCell.className = 'queue-remove';
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'queue-remove-btn'; remove.textContent = '×'; remove.title = 'Remove file'; remove.setAttribute('aria-label', 'Remove ' + entry.path); remove.disabled = entry.status === 'processing';
      remove.addEventListener('click', function () { queue = queue.filter(function (candidate) { return candidate !== entry; }); renderQueue(); });
      removeCell.appendChild(remove); row.append(checkCell, fileCell, sizeCell, statusCell, removeCell); return row;
    }

    function renderQueue() {
      syncExcludedStates();
      var visible = visibleEntries();
      queueBody.replaceChildren();
      var fragment = document.createDocumentFragment();
      visible.slice(0, MAX_RENDERED_ROWS).forEach(function (entry) { fragment.appendChild(createQueueRow(entry)); });
      queueBody.appendChild(fragment);
      if (queueEmpty) queueEmpty.classList.toggle('hidden', visible.length !== 0);
      if (overflowNote) {
        var hiddenRows = Math.max(0, visible.length - MAX_RENDERED_ROWS);
        overflowNote.classList.toggle('hidden', hiddenRows === 0);
        overflowNote.textContent = hiddenRows ? hiddenRows + ' more matching files are in the queue. Refine search to view them.' : '';
      }
      dropzone.classList.toggle('hidden', queue.length > 0);
      if (queuePanel) queuePanel.classList.toggle('hidden', queue.length === 0);
      updateSummary();
    }

    function handleInput(event) { addFiles(event.target.files); event.target.value = ''; }
    [filesInput, folderInput, queueFilesInput, queueFolderInput].forEach(function (input) { if (input) input.addEventListener('change', handleInput); });
    if (queueSearch) queueSearch.addEventListener('input', renderQueue);
    if (excludeInput) excludeInput.addEventListener('input', function () { clearTimeout(debounceTimer); debounceTimer = setTimeout(renderQueue, 160); });
    if (selectAllBtn) selectAllBtn.addEventListener('click', function () { visibleEntries().forEach(function (entry) { if (entry.status === 'ready') entry.selected = true; }); renderQueue(); });
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', function () { visibleEntries().forEach(function (entry) { if (entry.status === 'ready') entry.selected = false; }); renderQueue(); });
    if (removeSelectedBtn) removeSelectedBtn.addEventListener('click', function () {
      var removable = new Set(visibleEntries().filter(function (entry) { return effectiveSelected(entry) && entry.status !== 'processing'; }));
      queue = queue.filter(function (entry) { return !removable.has(entry); }); renderQueue();
    });

    async function filesFromDrop(event) {
      var items = event.dataTransfer && event.dataTransfer.items;
      if (items && items.length && typeof readDroppedFolder === 'function') {
        try { var recursive = await readDroppedFolder(items); if (recursive && recursive.length) return recursive; } catch (_error) {}
      }
      return Array.from(event.dataTransfer && event.dataTransfer.files || []);
    }
    dropzone.addEventListener('dragover', function (event) { event.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('drag-over'); });
    dropzone.addEventListener('drop', async function (event) { event.preventDefault(); dropzone.classList.remove('drag-over'); addFiles(await filesFromDrop(event)); });
    document.addEventListener('dragover', function (event) { event.preventDefault(); });
    document.addEventListener('drop', async function (event) { if (dropzone.contains(event.target)) return; event.preventDefault(); addFiles(await filesFromDrop(event)); });

    function setHidden(id, hidden) { var element = document.getElementById(id); if (element) element.classList.toggle('hidden', hidden); }
    function collectOptions(formData) {
      document.querySelectorAll('#options-panel input, #options-panel select').forEach(function (input) {
        if (!input.id || input.type === 'file' || input.disabled) return;
        formData.append(input.id, input.type === 'checkbox' ? String(input.checked) : input.value);
      });
    }
    function appendLog(data) {
      if (!logEl || !data.file) return;
      var row = document.createElement('div');
      row.className = data.type === 'php' ? 'log-php' : data.type === 'compress' ? 'log-compress' : data.type === 'skip' ? 'log-skip' : 'log-copy';
      var label = data.type === 'php' ? 'PHP' : data.type === 'compress' ? 'COMP' : data.type === 'skip' ? 'SKIP' : data.type === 'error' ? 'FAIL' : 'FILE';
      var message = '[' + label + '] ' + data.file;
      if (typeof data.originalSize === 'number' && typeof data.compressedSize === 'number') message += ' (' + formatSize(data.originalSize) + ' → ' + formatSize(data.compressedSize) + ')';
      row.textContent = message; logEl.appendChild(row); logEl.scrollTop = logEl.scrollHeight;
    }

    function recordProgress(data) {
      if (!data.file) return null;
      var entry = queue.find(function (item) { return item.path === data.file; });
      if (!entry) return null;
      if (data.type === 'error') { entry.status = 'failed'; entry.resultStatus = 'failed'; entry.errorMessage = data.message || 'Processing failed'; }
      else if (data.type === 'skip') { entry.status = 'done'; entry.resultStatus = 'skipped'; }
      else { entry.status = 'done'; entry.resultStatus = 'success'; }
      if (typeof data.originalSize === 'number') entry.originalSize = data.originalSize;
      if (typeof data.compressedSize === 'number') entry.outputSize = data.compressedSize;
      if (typeof data.reduction === 'number') entry.reduction = data.reduction;
      return entry;
    }

    function connectProgress(jobId, totalFiles) {
      if (!jobId) return;
      var source = new EventSource('/progress/' + encodeURIComponent(jobId));
      var processed = 0;
      source.onmessage = function (event) {
        var data; try { data = JSON.parse(event.data); } catch (_error) { return; }
        if (data.event === 'done') { source.close(); return; }
        processed++; recordProgress(data);
        if (typeof updateProgress === 'function') updateProgress(Math.min(100, processed / Math.max(totalFiles, 1) * 100));
        var done = document.getElementById('stat-done'); if (done) done.textContent = String(processed);
        var progressText = document.getElementById('progress-text'); if (progressText) progressText.textContent = data.file || 'Processing…';
        appendLog(data);
      };
      source.onerror = function () { source.close(); };
    }

    function metric(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }
    function resultStatusLabel(entry) { return entry.resultStatus === 'failed' ? 'Failed' : entry.resultStatus === 'skipped' ? 'Skipped' : 'Success'; }
    function createResultRow(entry) {
      var row = document.createElement('div'); row.className = 'results-row'; row.setAttribute('role', 'row');
      var file = document.createElement('div'); file.className = 'result-file';
      var name = document.createElement('strong'); name.textContent = entry.path.split('/').pop();
      var path = document.createElement('span'); path.textContent = entry.path; file.append(name, path);
      var status = document.createElement('div'); status.className = 'result-status-col';
      var badge = document.createElement('span'); badge.className = 'result-status-badge result-' + (entry.resultStatus || 'success'); badge.textContent = resultStatusLabel(entry); status.appendChild(badge);
      var input = document.createElement('div'); input.className = 'result-size-col'; input.textContent = typeof entry.originalSize === 'number' ? formatSize(entry.originalSize) : formatSize(entry.size);
      var output = document.createElement('div'); output.className = 'result-size-col'; output.textContent = typeof entry.outputSize === 'number' ? formatSize(entry.outputSize) : '—';
      var saved = document.createElement('div'); saved.className = 'result-saved-col';
      if (typeof entry.originalSize === 'number' && typeof entry.outputSize === 'number' && entry.originalSize > 0) saved.textContent = Math.max(0, Math.round((entry.originalSize - entry.outputSize) / entry.originalSize * 100)) + '%';
      else saved.textContent = '—';
      row.append(file, status, input, output, saved); return row;
    }

    function renderResults(entries) {
      if (!resultsPanel) return;
      var success = entries.filter(function (entry) { return entry.resultStatus === 'success'; });
      var skipped = entries.filter(function (entry) { return entry.resultStatus === 'skipped'; });
      var failed = entries.filter(function (entry) { return entry.resultStatus === 'failed'; });
      var withSizes = entries.filter(function (entry) { return typeof entry.originalSize === 'number' && typeof entry.outputSize === 'number'; });
      var inputBytes = withSizes.reduce(function (sum, entry) { return sum + entry.originalSize; }, 0);
      var outputBytes = withSizes.reduce(function (sum, entry) { return sum + entry.outputSize; }, 0);
      metric('result-success-count', String(success.length)); metric('result-skipped-count', String(skipped.length)); metric('result-failed-count', String(failed.length));
      metric('result-input-size', withSizes.length ? formatSize(inputBytes) : formatSize(entries.reduce(function (sum, entry) { return sum + entry.size; }, 0)));
      metric('result-output-size', withSizes.length ? formatSize(outputBytes) : '—');
      metric('result-saved-percent', withSizes.length && inputBytes > 0 ? Math.max(0, Math.round((inputBytes - outputBytes) / inputBytes * 100)) + '%' : '—');
      if (resultsBody) { resultsBody.replaceChildren(); var fragment = document.createDocumentFragment(); entries.forEach(function (entry) { fragment.appendChild(createResultRow(entry)); }); resultsBody.appendChild(fragment); }
      if (retryFailedBtn) retryFailedBtn.classList.toggle('hidden', failed.length === 0);
      if (resultsState) {
        resultsState.className = 'results-state ' + (failed.length ? (success.length || skipped.length ? 'results-state-warning' : 'results-state-error') : 'results-state-success');
        resultsState.textContent = failed.length ? (success.length || skipped.length ? 'Partial' : 'Failed') : 'Complete';
      }
      if (resultsSubtitle) resultsSubtitle.textContent = failed.length ? failed.length + ' file' + (failed.length === 1 ? '' : 's') + ' failed. You can retry only those files.' : (skipped.length ? skipped.length + ' file' + (skipped.length === 1 ? ' was' : 's were') + ' passed through without processing.' : 'All selected files completed successfully.');
      resultsPanel.classList.remove('hidden');
    }

    async function startProcessing(entries) {
      if (!entries.length) return;
      if (processedBlob) processedBlob = null;
      entries.forEach(function (entry) { clearEntryResult(entry); entry.status = 'processing'; entry.selected = true; });
      renderQueue();
      if (queuePanel) queuePanel.classList.add('hidden');
      if (resultsPanel) resultsPanel.classList.add('hidden');
      setHidden('stats', false); setHidden('progress-wrap', false); if (logWrap) logWrap.classList.remove('hidden');
      var total = document.getElementById('stat-total'); var done = document.getElementById('stat-done'); var saved = document.getElementById('stat-saved');
      if (total) total.textContent = String(entries.length); if (done) done.textContent = '0'; if (saved) saved.textContent = '0%';
      var formData = new FormData(); entries.forEach(function (entry) { formData.append('files', entry.file); formData.append('paths', entry.path); }); collectOptions(formData);
      try {
        var response = await fetch(window.toolEndpoint || '/upload', { method:'POST', body:formData });
        if (!response.ok) { var errorText = await response.text(); throw new Error(errorText && errorText.length < 180 ? errorText : 'Server error (' + response.status + ')'); }
        connectProgress(response.headers.get('X-Job-Id'), entries.length);
        var disposition = response.headers.get('content-disposition') || ''; var filenameMatch = disposition.match(/filename="?([^";]+)"?/i); if (filenameMatch) downloadName = filenameMatch[1];
        processedBlob = await response.blob();
        entries.forEach(function (entry) { if (entry.status === 'processing') { entry.status = 'done'; entry.resultStatus = 'success'; } });
        if (typeof updateProgress === 'function') updateProgress(100); setHidden('progress-wrap', true); renderResults(entries);
        var failedCount = entries.filter(function (entry) { return entry.resultStatus === 'failed'; }).length;
        toast(failedCount ? 'info' : 'success', failedCount ? 'Processing finished with ' + failedCount + ' failed file' + (failedCount === 1 ? '' : 's') + '.' : entries.length + ' file' + (entries.length === 1 ? '' : 's') + ' processed successfully.');
      } catch (error) {
        console.error(error);
        entries.forEach(function (entry) { if (entry.status === 'processing') { entry.status = 'failed'; entry.resultStatus = 'failed'; entry.errorMessage = error.message; } });
        setHidden('progress-wrap', true); renderResults(entries); toast('error', 'Processing failed: ' + error.message, 5000);
      }
    }

    proceedBtn.addEventListener('click', function () { var entries = selectedEntries().filter(function (entry) { return entry.status === 'ready'; }); if (!entries.length) return toast('error', 'Select at least one ready file to process.'); startProcessing(entries); });
    if (retryFailedBtn) retryFailedBtn.addEventListener('click', function () {
      var failed = queue.filter(function (entry) { return entry.resultStatus === 'failed'; });
      failed.forEach(function (entry) { entry.status = 'ready'; entry.selected = true; clearEntryResult(entry); });
      if (!failed.length) return; startProcessing(failed);
    });
    if (reviewQueueBtn) reviewQueueBtn.addEventListener('click', function () {
      queue.forEach(function (entry) { if (entry.status === 'done') { entry.status = 'ready'; entry.selected = false; } });
      if (resultsPanel) resultsPanel.classList.add('hidden'); if (queuePanel) queuePanel.classList.remove('hidden'); renderQueue();
    });
    if (downloadBtn) downloadBtn.addEventListener('click', function () {
      if (!processedBlob) return toast('error', 'No downloadable result is available.');
      if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(processedBlob);
      var link = document.createElement('a'); link.href = objectUrl; link.download = downloadName; document.body.appendChild(link); link.click(); link.remove(); toast('info', 'Download started.');
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; processedBlob = null; queue = [];
      if (logEl) logEl.replaceChildren(); setHidden('stats', true); setHidden('progress-wrap', true); setHidden('log-wrap', true); if (resultsPanel) resultsPanel.classList.add('hidden'); renderQueue();
    });

    renderQueue();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initToolRunner); else initToolRunner();
})();
