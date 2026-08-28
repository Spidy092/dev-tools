/* Checksum & Manifest adapter for shared DevToolkit workflow. */
(function () {
  var workspace = document.querySelector('.workspace[data-tool-id="checksum-manifest"]');
  if (!workspace) return;

  var mode = document.getElementById('checksumMode');
  var outputGroup = document.getElementById('output-format-group');
  var manifestGroup = document.getElementById('manifest-file-group');
  var manifestInput = document.getElementById('manifest-file-input');
  var manifestJson = document.getElementById('manifestJson');
  var processBtn = document.getElementById('proceed-btn');
  var originalFetch = window.fetch.bind(window);
  var lastDownload = null;

  function syncMode() {
    var verify = mode && mode.value === 'verify';
    if (outputGroup) outputGroup.classList.toggle('hidden', verify);
    if (manifestGroup) manifestGroup.classList.toggle('hidden', !verify);
    window.toolEndpoint = verify ? '/file-tools/checksums/verify' : '/file-tools/checksums/generate';
    window.toolProcessLabel = verify ? 'Verify Manifest' : 'Generate Manifest';
    if (processBtn && !processBtn.disabled) processBtn.textContent = window.toolProcessLabel;
  }

  function formatSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function metric(label, value) {
    var div = document.createElement('div'); div.className = 'result-metric';
    var span = document.createElement('span'); span.textContent = label;
    var strong = document.createElement('strong'); strong.textContent = String(value);
    div.append(span, strong); return div;
  }

  function section(title, items, stateClass) {
    if (!items || !items.length) return null;
    var card = document.createElement('article'); card.className = 'duplicate-group-card';
    var heading = document.createElement('div'); heading.className = 'duplicate-group-heading';
    var left = document.createElement('div'); var label = document.createElement('span'); label.textContent = stateClass.toUpperCase();
    var strong = document.createElement('strong'); strong.textContent = title + ' (' + items.length + ')'; left.append(label, strong); heading.appendChild(left); card.appendChild(heading);
    var list = document.createElement('div'); list.className = 'duplicate-file-list';
    items.slice(0, 300).forEach(function (item) {
      var row = document.createElement('div'); row.className = 'duplicate-file-row';
      var badge = document.createElement('span'); badge.className = stateClass === 'valid' ? 'duplicate-original' : 'duplicate-copy'; badge.textContent = stateClass.toUpperCase();
      var path = document.createElement('code'); path.textContent = item.path || 'file'; row.append(badge, path); list.appendChild(row);
    });
    if (items.length > 300) { var more = document.createElement('div'); more.className = 'duplicate-group-meta'; more.textContent = (items.length - 300) + ' more entries are included in the report.'; list.appendChild(more); }
    card.appendChild(list); return card;
  }

  function renderVerification(report) {
    var panel = document.getElementById('checksum-results');
    var metrics = document.getElementById('checksum-result-metrics');
    var list = document.getElementById('checksum-result-list');
    var generic = document.getElementById('results-panel');
    var subtitle = document.getElementById('checksum-results-subtitle');
    var state = document.getElementById('checksum-results-state');
    if (!panel || !metrics || !list) return;
    if (generic) generic.classList.add('hidden');
    var summary = report.summary || {};
    metrics.replaceChildren(metric('Expected', summary.expected || 0), metric('Current', summary.current || 0), metric('Valid', summary.valid || 0), metric('Changed', summary.changed || 0), metric('Missing', summary.missing || 0), metric('New', summary.added || 0));
    list.replaceChildren();
    [section('Changed files', report.changed, 'changed'), section('Missing files', report.missing, 'missing'), section('New files', report.added, 'new'), section('Valid files', report.valid, 'valid')].forEach(function (card) { if (card) list.appendChild(card); });
    if (subtitle) subtitle.textContent = summary.clean ? 'Project matches the saved manifest exactly.' : 'Integrity differences were detected. Review changed, missing, and new paths.';
    if (state) { state.textContent = summary.clean ? 'Verified' : 'Differences'; state.className = 'results-state ' + (summary.clean ? 'results-state-success' : 'results-state-warning'); }
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var response = await originalFetch(input, init);
    if (url.indexOf('/file-tools/checksums/verify') !== -1 && response.ok) {
      response.clone().json().then(renderVerification).catch(function () {});
      setTimeout(function () { var generic = document.getElementById('results-panel'); if (generic) generic.classList.add('hidden'); }, 0);
    }
    return response;
  };

  if (mode) mode.addEventListener('change', syncMode);
  if (manifestInput) manifestInput.addEventListener('change', function () {
    var file = manifestInput.files && manifestInput.files[0];
    if (!file) { if (manifestJson) manifestJson.value = ''; return; }
    if (file.size > 120 * 1024) {
      manifestInput.value = ''; if (manifestJson) manifestJson.value = '';
      if (typeof Toast !== 'undefined' && Toast.error) Toast.error('Manifest is too large for the current verification channel (120 KB max).');
      return;
    }
    var reader = new FileReader(); reader.onload = function () { if (manifestJson) manifestJson.value = String(reader.result || ''); }; reader.readAsText(file);
  });

  var back = document.getElementById('checksum-back-btn');
  if (back) back.addEventListener('click', function () { var panel = document.getElementById('checksum-results'); var queue = document.getElementById('file-tree-panel'); if (panel) panel.classList.add('hidden'); if (queue) queue.classList.remove('hidden'); });
  syncMode();
})();
