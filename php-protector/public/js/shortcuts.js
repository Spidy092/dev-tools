/**
 * Keyboard shortcuts: Ctrl+U upload, Ctrl+D download, Esc reset
 */
document.addEventListener('keydown', function(e) {
  // Don't trigger when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }

  if (e.ctrlKey && e.key === 'u') {
    e.preventDefault();
    var input = document.getElementById('folder-input');
    if (input) input.click();
  }

  if (e.ctrlKey && e.key === 'd') {
    e.preventDefault();
    var btn = document.getElementById('download-btn');
    if (btn && !btn.closest('.hidden')) btn.click();
  }

  if (e.key === 'Escape') {
    var resetBtn = document.getElementById('reset-btn');
    if (resetBtn && !resetBtn.closest('.hidden')) resetBtn.click();
    // Also close command palette
    var palette = document.getElementById('cmd-palette');
    if (palette) palette.classList.add('hidden');
  }
});
