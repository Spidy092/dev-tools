(function () {
  function bindToggle(toggleId, targetId) {
    var toggle = document.getElementById(toggleId);
    var target = document.getElementById(targetId);
    if (!toggle || !target) return;
    function sync() { target.disabled = !toggle.checked; }
    toggle.addEventListener('change', sync);
    sync();
  }

  function init() {
    bindToggle('blur-toggle', 'blur');
    bindToggle('renamePatternToggle', 'renamePattern');

    var level = document.getElementById('level');
    var custom = document.getElementById('custom-quality-group');
    if (level && custom) {
      function syncCustomQuality() {
        custom.style.display = level.value === 'custom' ? 'block' : 'none';
      }
      level.addEventListener('change', syncCustomQuality);
      syncCustomQuality();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
