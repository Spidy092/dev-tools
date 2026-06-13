/**
 * Command Palette — Ctrl+K to open, search and switch between tools
 */
(function() {
  var tools = [
    { name: 'PHP Protector', url: '/php-protector', icon: '🛡️', tag: 'security obfuscate' },
    { name: 'Image Resizer', url: '/image-resizer', icon: '📐', tag: 'resize crop' },
    { name: 'Image Converter', url: '/image-converter', icon: '🔄', tag: 'webp avif png jpeg convert' },
    { name: 'Image Compressor', url: '/image-compressor', icon: '🗜️', tag: 'compress shrink optimize heic avif tiff' },
    { name: 'PDF Compressor', url: '/pdf-compressor', icon: '📄', tag: 'compress shrink pdf' },
    { name: 'File Renamer', url: '/file-renamer', icon: '🏷️', tag: 'rename bulk clean' },
    { name: 'Code Minifier', url: '/code-minifier', icon: '⚡', tag: 'minify html css js' },
    { name: 'Dashboard', url: '/', icon: '🏠', tag: 'home index' },
    { name: 'Settings', url: '/settings', icon: '⚙️', tag: 'preferences config' }
  ];

  // Inject palette HTML
  var el = document.createElement('div');
  el.id = 'cmd-palette';
  el.className = 'hidden';
  el.innerHTML = '<div class="cmd-overlay"></div><div class="cmd-modal"><input type="text" class="cmd-input" placeholder="Search tools... (Ctrl+K)" autocomplete="off"><div class="cmd-results"></div><div class="cmd-hint">↑↓ navigate · Enter select · Esc close</div></div>';
  document.body.appendChild(el);

  var input = el.querySelector('.cmd-input');
  var results = el.querySelector('.cmd-results');
  var activeIdx = 0;

  function open() {
    el.classList.remove('hidden');
    input.value = '';
    activeIdx = 0;
    render('');
    setTimeout(function() { input.focus(); }, 50);
  }

  function close() { el.classList.add('hidden'); }

  function render(query) {
    var q = query.toLowerCase();
    var filtered = tools.filter(function(t) {
      return !q || t.name.toLowerCase().includes(q) || t.tag.includes(q);
    });
    activeIdx = Math.min(activeIdx, Math.max(0, filtered.length - 1));
    results.innerHTML = filtered.map(function(t, i) {
      return '<a href="' + t.url + '" class="cmd-item' + (i === activeIdx ? ' active' : '') + '"><span class="cmd-icon">' + t.icon + '</span><span>' + t.name + '</span></a>';
    }).join('');
  }

  input.addEventListener('input', function() { activeIdx = 0; render(input.value); });

  input.addEventListener('keydown', function(e) {
    var items = results.querySelectorAll('.cmd-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); render(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); render(input.value); }
    else if (e.key === 'Enter') { e.preventDefault(); var active = items[activeIdx]; if (active) window.location.href = active.href; }
    else if (e.key === 'Escape') { close(); }
  });

  el.querySelector('.cmd-overlay').addEventListener('click', close);

  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'k') { e.preventDefault(); open(); }
  });
})();
