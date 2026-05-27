// Theme toggle
(function() {
  var html = document.documentElement;
  var stored = localStorage.getItem('devtoolkit_theme') || 'dark';
  html.setAttribute('data-theme', stored);

  function setup() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'theme-toggle';
      btn.id = 'theme-toggle';
      btn.setAttribute('aria-label', 'Toggle theme');
      
      var container = document.querySelector('.topnav-actions');
      if (container) {
        container.insertBefore(btn, container.firstChild);
      } else {
        document.body.appendChild(btn);
      }
    }
    btn.textContent = html.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';

    btn.addEventListener('click', function() {
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('devtoolkit_theme', next);
      btn.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
