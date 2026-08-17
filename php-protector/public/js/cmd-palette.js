/** Command Palette — Ctrl/Cmd+K, powered by the server tool registry. */
(function() {
  var tools = [
    { name: 'Dashboard', route: '/', icon: '🏠', keywords: ['home'] },
    { name: 'Settings', route: '/settings', icon: '⚙️', keywords: ['preferences'] }
  ];

  fetch('/api/tools')
    .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('registry unavailable')); })
    .then(function(data) {
      if (data && Array.isArray(data.tools)) tools = data.tools.concat(tools);
    })
    .catch(function() {});

  var el = document.createElement('div');
  el.id = 'cmd-palette';
  el.className = 'hidden';

  var overlay = document.createElement('div');
  overlay.className = 'cmd-overlay';

  var modal = document.createElement('div');
  modal.className = 'cmd-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Search DevToolkit tools');

  var input = document.createElement('input');
  input.type = 'search';
  input.className = 'cmd-input';
  input.placeholder = 'Search tools...';
  input.autocomplete = 'off';

  var results = document.createElement('div');
  results.className = 'cmd-results';

  var hint = document.createElement('div');
  hint.className = 'cmd-hint';
  hint.textContent = '↑↓ navigate · Enter select · Esc close';

  modal.appendChild(input);
  modal.appendChild(results);
  modal.appendChild(hint);
  el.appendChild(overlay);
  el.appendChild(modal);
  document.body.appendChild(el);

  var activeIdx = 0;

  function matches(tool, query) {
    if (!query) return true;
    var haystack = [tool.name, tool.category, tool.description]
      .concat(tool.keywords || [])
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function getFiltered(query) {
    var q = String(query || '').trim().toLowerCase();
    return tools.filter(function(tool) { return matches(tool, q); });
  }

  function render(query) {
    var filtered = getFiltered(query);
    activeIdx = Math.min(activeIdx, Math.max(0, filtered.length - 1));
    results.replaceChildren();

    filtered.forEach(function(tool, index) {
      var link = document.createElement('a');
      link.href = tool.route || tool.url || '/';
      link.className = 'cmd-item' + (index === activeIdx ? ' active' : '');

      var icon = document.createElement('span');
      icon.className = 'cmd-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = tool.icon || '•';

      var label = document.createElement('span');
      label.textContent = tool.name;

      link.appendChild(icon);
      link.appendChild(label);
      results.appendChild(link);
    });
  }

  function open() {
    el.classList.remove('hidden');
    input.value = '';
    activeIdx = 0;
    render('');
    setTimeout(function() { input.focus(); }, 20);
  }

  function close() {
    el.classList.add('hidden');
  }

  input.addEventListener('input', function() {
    activeIdx = 0;
    render(input.value);
  });

  input.addEventListener('keydown', function(e) {
    var items = results.querySelectorAll('.cmd-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, Math.max(0, items.length - 1));
      render(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      render(input.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var active = results.querySelectorAll('.cmd-item')[activeIdx];
      if (active) window.location.href = active.href;
    } else if (e.key === 'Escape') {
      close();
    }
  });

  overlay.addEventListener('click', close);
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      el.classList.contains('hidden') ? open() : close();
    }
  });
})();
