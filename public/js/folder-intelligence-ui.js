/* Client-only folder/project intelligence UI. */
(function () {
  function initFolderIntelligence() {
    var panel = document.getElementById('folder-intelligence');
    var statsEl = document.getElementById('folder-intelligence-stats');
    var filtersEl = document.getElementById('folder-intelligence-filters');
    var typesEl = document.getElementById('folder-intelligence-types');
    var largestEl = document.getElementById('folder-intelligence-largest');
    var titleEl = document.getElementById('folder-intelligence-title');
    var clearBtn = document.getElementById('folder-filter-clear');
    var resetBtn = document.getElementById('reset-btn');
    var queueBody = document.getElementById('file-tree');
    if (!panel || !queueBody || !window.DevToolkitFolderIntelligence) return;

    var filesByKey = new Map();
    var analysis = window.DevToolkitFolderIntelligence.analyze([]);

    function toast(method, message) { if (typeof Toast !== 'undefined' && Toast[method]) Toast[method](message); }
    function formatSize(bytes) {
      bytes = Number(bytes) || 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    function pathFor(file) { return String(file.webkitRelativePath || file.name || 'file').replace(/\\/g, '/'); }
    function keyFor(file) { return [pathFor(file), file.size || 0, file.lastModified || 0].join('::'); }
    function addFiles(files) { Array.from(files || []).forEach(function (file) { filesByKey.set(keyFor(file), { path:pathFor(file), size:file.size || 0 }); }); render(); }
    function removePath(pathname) { Array.from(filesByKey.entries()).forEach(function (pair) { if (pair[1].path === pathname) filesByKey.delete(pair[0]); }); render(); }
    function snapshot() { return Array.from(filesByKey.values()); }

    async function filesFromDrop(event) {
      var items = event.dataTransfer && event.dataTransfer.items;
      if (items && items.length && typeof readDroppedFolder === 'function') {
        try { var recursive = await readDroppedFolder(items); if (recursive && recursive.length) return recursive; } catch (_error) {}
      }
      return Array.from(event.dataTransfer && event.dataTransfer.files || []);
    }

    document.addEventListener('change', function (event) {
      var input = event.target;
      if (!input || input.type !== 'file' || !/^(files-input|folder-input|queue-files-input|queue-folder-input)$/.test(input.id)) return;
      addFiles(input.files);
    }, true);
    document.addEventListener('drop', function (event) { filesFromDrop(event).then(addFiles).catch(function () {}); }, true);

    queueBody.addEventListener('click', function (event) {
      var button = event.target.closest('.queue-remove-btn'); if (!button) return;
      var row = button.closest('.queue-row'); var path = row && row.querySelector('.queue-file span');
      if (path) removePath(path.textContent.trim());
    });
    var removeSelectedBtn = document.getElementById('remove-selected-btn');
    if (removeSelectedBtn) removeSelectedBtn.addEventListener('click', function () {
      queueBody.querySelectorAll('.queue-row').forEach(function (row) {
        var checkbox = row.querySelector('.queue-check input[type="checkbox"]'); var path = row.querySelector('.queue-file span');
        if (checkbox && checkbox.checked && path) removePath(path.textContent.trim());
      });
    }, true);
    if (resetBtn) resetBtn.addEventListener('click', function () { filesByKey.clear(); render(); }, true);

    function stat(label, value, hint) {
      var el = document.createElement('div'); el.className = 'folder-stat';
      var strong = document.createElement('strong'); strong.textContent = value;
      var span = document.createElement('span'); span.textContent = label; el.append(strong, span);
      if (hint) { var small = document.createElement('small'); small.textContent = hint; el.appendChild(small); }
      return el;
    }
    function quickFilter(label, filter, count) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'folder-filter-chip';
      button.textContent = 'Select ' + label + ' · ' + count; button.disabled = count === 0;
      button.addEventListener('click', function () { selectMatching(filter); }); return button;
    }
    function selectMatching(filter) {
      var rows = Array.from(queueBody.querySelectorAll('.queue-row'));
      if (analysis.count > rows.length) {
        toast('info', 'This queue is larger than the rendered list. Narrow it with search before using quick selection so hidden files are not changed accidentally.');
        return 0;
      }
      var threshold = analysis.largeThreshold; var inventory = snapshot(); var changed = 0;
      rows.forEach(function (row) {
        var path = row.querySelector('.queue-file span'); var checkbox = row.querySelector('.queue-check input[type="checkbox"]');
        if (!path || !checkbox || checkbox.disabled) return;
        var pathname = path.textContent.trim();
        var item = inventory.find(function (entry) { return entry.path === pathname; });
        var match = filter === 'all' || (item && window.DevToolkitFolderIntelligence.matchesFilter(item, filter, threshold));
        if (checkbox.checked !== match) { checkbox.checked = match; checkbox.dispatchEvent(new Event('change', { bubbles:true })); changed++; }
      });
      toast('info', filter === 'all' ? 'All ready files selected.' : 'Selection changed to ' + filter + ' files.');
      return changed;
    }
    if (clearBtn) clearBtn.addEventListener('click', function () { selectMatching('all'); });

    function render() {
      analysis = window.DevToolkitFolderIntelligence.analyze(snapshot());
      panel.classList.toggle('hidden', analysis.count === 0); if (!analysis.count) return;
      titleEl.textContent = analysis.root ? analysis.root + ' summary' : 'Selection summary';
      statsEl.replaceChildren(stat('Files', String(analysis.count)), stat('Total size', formatSize(analysis.totalBytes)), stat('Folders', String(analysis.folders)), stat('Large files', String(analysis.large.length), '≥ ' + formatSize(analysis.largeThreshold)));
      filtersEl.replaceChildren(quickFilter('Images', 'images', analysis.groups.images), quickFilter('Code', 'code', analysis.groups.code), quickFilter('Data', 'data', analysis.groups.data), quickFilter('PDFs', 'pdfs', analysis.groups.pdfs), quickFilter('Docs', 'docs', analysis.groups.docs), quickFilter('Archives', 'archives', analysis.groups.archives), quickFilter('Large', 'large', analysis.large.length));
      typesEl.replaceChildren();
      analysis.topExtensions.forEach(function (item) { var row = document.createElement('div'); row.className = 'folder-type-row'; var name = document.createElement('code'); name.textContent = item.extension === '(no extension)' ? item.extension : '.' + item.extension; var count = document.createElement('span'); count.textContent = String(item.count); row.append(name, count); typesEl.appendChild(row); });
      largestEl.replaceChildren();
      analysis.largest.forEach(function (item) { var row = document.createElement('div'); row.className = 'folder-largest-row'; var path = document.createElement('span'); path.textContent = item.path; var size = document.createElement('strong'); size.textContent = formatSize(item.size); row.append(path, size); largestEl.appendChild(row); });
    }
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFolderIntelligence); else initFolderIntelligence();
})();
