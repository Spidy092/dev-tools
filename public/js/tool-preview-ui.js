/* Shared preview gate for DevToolkit processing actions. */
(function () {
  function initPreviewUi() {
    var workspace = document.querySelector('.workspace[data-tool-id]');
    var proceedBtn = document.getElementById('proceed-btn');
    var panel = document.getElementById('preview-panel');
    var body = document.getElementById('preview-body');
    var summary = document.getElementById('preview-summary');
    var warnings = document.getElementById('preview-warnings');
    var stats = document.getElementById('preview-stats');
    var confirmBtn = document.getElementById('preview-confirm-btn');
    var backBtn = document.getElementById('preview-back-btn');
    var queuePanel = document.getElementById('file-tree-panel');
    if (!workspace || !proceedBtn || !panel || !body || !confirmBtn || !window.DevToolkitPreview) return;

    var bypassOnce = false;
    var previewValid = false;
    var MAX_PREVIEW_ROWS = 100;

    function selectedCountFromSummary() {
      var el = document.getElementById('queue-selected-count');
      var match = el && el.textContent.match(/(\d+)/);
      return match ? Number(match[1]) : 0;
    }

    function syncPreviewLabel() {
      var count = selectedCountFromSummary();
      proceedBtn.textContent = 'Preview changes' + (count ? ' (' + count + ')' : '');
    }

    function collectOptions() {
      var options = {};
      document.querySelectorAll('#options-panel input, #options-panel select').forEach(function (input) {
        if (!input.id || input.disabled || input.type === 'file') return;
        options[input.id] = input.type === 'checkbox' ? input.checked : input.value;
      });
      return options;
    }

    function selectedDomEntries() {
      return Array.from(document.querySelectorAll('#file-tree .queue-row')).filter(function (row) {
        var checkbox = row.querySelector('.queue-check input[type="checkbox"]');
        var status = row.querySelector('.queue-status-badge');
        return checkbox && checkbox.checked && !checkbox.disabled && (!status || status.textContent.trim() === 'Ready');
      }).map(function (row) {
        var path = row.querySelector('.queue-file span');
        return { path: path ? path.textContent.trim() : 'file' };
      });
    }

    function renderRow(row) {
      var el = document.createElement('div'); el.className = 'preview-row';
      var input = document.createElement('div'); input.className = 'preview-path';
      var inputLabel = document.createElement('span'); inputLabel.textContent = 'Before';
      var inputValue = document.createElement('code'); inputValue.textContent = row.input;
      input.append(inputLabel, inputValue);
      var arrow = document.createElement('div'); arrow.className = 'preview-arrow'; arrow.textContent = row.changed ? '→' : '=';
      var output = document.createElement('div'); output.className = 'preview-path';
      var outputLabel = document.createElement('span'); outputLabel.textContent = row.skipped ? 'Unchanged' : 'After';
      var outputValue = document.createElement('code'); outputValue.textContent = row.output;
      output.append(outputLabel, outputValue);
      if (row.changed) el.classList.add('preview-changed');
      if (row.skipped) el.classList.add('preview-skipped');
      el.append(input, arrow, output); return el;
    }

    function showPreview() {
      var entries = selectedDomEntries();
      var selectedCount = selectedCountFromSummary();
      if (!selectedCount) return;
      var toolId = workspace.dataset.toolId;
      var preview = window.DevToolkitPreview.buildPreview(toolId, entries, collectOptions());
      if (summary) summary.textContent = preview.summary;
      if (stats) {
        stats.replaceChildren();
        [['Selected', selectedCount], ['Path changes', preview.changes], ['Collisions', preview.collisions], ['Pass-through', preview.skipped]].forEach(function (item) {
          var card = document.createElement('div'); card.className = 'preview-stat';
          var strong = document.createElement('strong'); strong.textContent = String(item[1]);
          var span = document.createElement('span'); span.textContent = item[0]; card.append(strong, span); stats.appendChild(card);
        });
      }
      body.replaceChildren();
      preview.rows.slice(0, MAX_PREVIEW_ROWS).forEach(function (row) { body.appendChild(renderRow(row)); });
      if (selectedCount > entries.length) {
        var note = document.createElement('p'); note.className = 'preview-note';
        note.textContent = 'The queue contains ' + selectedCount + ' selected files. This preview shows the currently rendered selection; processing will still include the full selected queue.';
        body.appendChild(note);
      } else if (preview.rows.length > MAX_PREVIEW_ROWS) {
        var overflow = document.createElement('p'); overflow.className = 'preview-note';
        overflow.textContent = (preview.rows.length - MAX_PREVIEW_ROWS) + ' more preview rows are hidden for performance.'; body.appendChild(overflow);
      }
      warnings.replaceChildren();
      preview.warnings.forEach(function (warning) { var item = document.createElement('div'); item.className = 'preview-warning'; item.textContent = warning; warnings.appendChild(item); });
      if (!preview.warnings.length) { var ok = document.createElement('div'); ok.className = 'preview-ok'; ok.textContent = 'No preview warnings detected.'; warnings.appendChild(ok); }
      panel.classList.remove('hidden');
      if (queuePanel) queuePanel.classList.add('preview-open');
      previewValid = true;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function invalidatePreview() {
      previewValid = false;
      panel.classList.add('hidden');
      if (queuePanel) queuePanel.classList.remove('preview-open');
      setTimeout(syncPreviewLabel, 0);
    }

    proceedBtn.addEventListener('click', function (event) {
      if (bypassOnce) { bypassOnce = false; return; }
      event.preventDefault(); event.stopImmediatePropagation();
      showPreview();
    }, true);

    confirmBtn.addEventListener('click', function () {
      if (!previewValid) return showPreview();
      bypassOnce = true; panel.classList.add('hidden');
      if (queuePanel) queuePanel.classList.remove('preview-open');
      proceedBtn.click();
    });
    if (backBtn) backBtn.addEventListener('click', function () { invalidatePreview(); proceedBtn.focus(); });

    document.addEventListener('input', function (event) {
      if (event.target && (event.target.closest('#options-panel') || event.target.closest('#file-tree-panel'))) invalidatePreview();
    });
    document.addEventListener('change', function (event) {
      if (event.target && (event.target.closest('#options-panel') || event.target.closest('#file-tree-panel'))) invalidatePreview();
    });

    var countEl = document.getElementById('queue-selected-count');
    if (countEl && window.MutationObserver) new MutationObserver(syncPreviewLabel).observe(countEl, { childList: true, characterData: true, subtree: true });
    syncPreviewLabel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPreviewUi); else initPreviewUi();
})();
