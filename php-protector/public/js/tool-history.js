(function () {
  var RECENTS_KEY = 'devtoolkit_recents_v1';
  var MAX_RECENTS = 8;

  function readRecents() {
    try {
      var value = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      return Array.isArray(value) ? value.filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }

  function record(toolId) {
    if (!toolId) return;
    var current = readRecents();
    var next = [toolId].concat(current.filter(function (id) { return id !== toolId; })).slice(0, MAX_RECENTS);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch (_error) {}
  }

  function init() {
    var workspace = document.querySelector('.workspace[data-tool-id]');
    if (workspace) record(workspace.dataset.toolId);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
