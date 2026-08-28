/* Duplicate Finder adapter: preserves shared runner while rendering JSON scan results. */
(function () {
  var workspace = document.querySelector('.workspace[data-tool-id="duplicate-finder"]');
  if (!workspace) return;

  var originalFetch = window.fetch.bind(window);
  var latestReport = null;

  function formatSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function renderReport(report) {
    latestReport = report;
    var panel = document.getElementById('duplicate-results');
    var groupsEl = document.getElementById('duplicate-groups');
    var genericResults = document.getElementById('results-panel');
    if (!panel || !groupsEl) return;

    if (genericResults) genericResults.classList.add('hidden');
    setText('dup-total-files', report.totalFiles || 0);
    setText('dup-hashed-files', report.hashedFiles || 0);
    setText('dup-groups', report.duplicateGroups || 0);
    setText('dup-extra-copies', report.extraCopies || 0);
    setText('dup-recoverable', formatSize(report.recoverableBytes || 0));

    var subtitle = document.getElementById('duplicate-results-subtitle');
    var state = document.getElementById('duplicate-results-state');
    if (report.duplicateGroups) {
      if (subtitle) subtitle.textContent = report.duplicateGroups + ' exact duplicate group' + (report.duplicateGroups === 1 ? '' : 's') + ' found. Potential recovery: ' + formatSize(report.recoverableBytes || 0) + '.';
      if (state) { state.textContent = 'Duplicates found'; state.className = 'results-state results-state-warning'; }
    } else {
      if (subtitle) subtitle.textContent = 'No exact duplicates were found in the selected files.';
      if (state) { state.textContent = 'Clean'; state.className = 'results-state results-state-success'; }
    }

    groupsEl.replaceChildren();
    (report.groups || []).forEach(function (group, index) {
      var card = document.createElement('article'); card.className = 'duplicate-group-card';
      var header = document.createElement('div'); header.className = 'duplicate-group-heading';
      var title = document.createElement('div');
      var eyebrow = document.createElement('span'); eyebrow.textContent = 'GROUP ' + (index + 1);
      var strong = document.createElement('strong'); strong.textContent = group.files.length + ' identical files';
      title.append(eyebrow, strong);
      var recovery = document.createElement('div'); recovery.className = 'duplicate-recovery';
      var recoveryLabel = document.createElement('span'); recoveryLabel.textContent = 'Recoverable';
      var recoveryValue = document.createElement('strong'); recoveryValue.textContent = formatSize(group.recoverableBytes || 0);
      recovery.append(recoveryLabel, recoveryValue); header.append(title, recovery);

      var meta = document.createElement('div'); meta.className = 'duplicate-group-meta';
      var hash = document.createElement('code'); hash.textContent = 'SHA-256 ' + String(group.hash || '').slice(0, 20) + '…';
      var size = document.createElement('span'); size.textContent = 'Each file: ' + formatSize(group.size || 0);
      meta.append(hash, size);

      var list = document.createElement('div'); list.className = 'duplicate-file-list';
      (group.files || []).forEach(function (pathname, fileIndex) {
        var row = document.createElement('div'); row.className = 'duplicate-file-row';
        var badge = document.createElement('span'); badge.textContent = fileIndex === 0 ? 'KEEP?' : 'COPY'; badge.className = fileIndex === 0 ? 'duplicate-original' : 'duplicate-copy';
        var path = document.createElement('code'); path.textContent = pathname;
        row.append(badge, path); list.appendChild(row);
      });
      card.append(header, meta, list); groupsEl.appendChild(card);
    });

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var response = await originalFetch(input, init);
    if (url.indexOf('/file-tools/duplicates') !== -1 && response.ok) {
      response.clone().json().then(renderReport).catch(function () {});
    }
    return response;
  };

  function syncMinimumSize() {
    var mb = document.getElementById('minimumSizeMb');
    var bytes = document.getElementById('minimumSizeBytes');
    if (!mb || !bytes) return;
    var value = Math.max(0, Number(mb.value) || 0);
    bytes.value = String(Math.floor(value * 1024 * 1024));
  }

  function initControls() {
    var mb = document.getElementById('minimumSizeMb');
    if (mb) { mb.addEventListener('input', syncMinimumSize); mb.addEventListener('change', syncMinimumSize); }
    syncMinimumSize();

    var exportBtn = document.getElementById('duplicate-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      if (!latestReport) return;
      var blob = new Blob([JSON.stringify(latestReport, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a'); link.href = url; link.download = 'devtoolkit-duplicate-report.json'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    });

    var backBtn = document.getElementById('duplicate-back-btn');
    if (backBtn) backBtn.addEventListener('click', function () {
      var panel = document.getElementById('duplicate-results');
      var queue = document.getElementById('file-tree-panel');
      if (panel) panel.classList.add('hidden');
      if (queue) queue.classList.remove('hidden');
      if (queue) queue.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initControls);
  else initControls();
})();
