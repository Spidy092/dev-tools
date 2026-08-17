(function () {
  var FAVORITES_KEY = 'devtoolkit_favorites_v1';
  var RECENTS_KEY = 'devtoolkit_recents_v1';
  var MAX_RECENTS = 8;

  function readList(key) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }

  function writeList(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_error) {}
  }

  function init() {
    var catalog = document.getElementById('tool-catalog');
    if (!catalog) return;

    var search = document.getElementById('catalog-search');
    var count = document.getElementById('catalog-count');
    var empty = document.getElementById('catalog-empty');
    var favoritesCount = document.getElementById('favorites-count');
    var cards = Array.from(catalog.querySelectorAll('[data-tool-id]'));
    var filters = Array.from(document.querySelectorAll('.catalog-filter'));
    var favoriteButtons = Array.from(document.querySelectorAll('[data-favorite-tool]'));
    var toolLinks = Array.from(document.querySelectorAll('[data-tool-link]'));
    var activeFilter = 'all';
    var favorites = new Set(readList(FAVORITES_KEY));
    var recents = readList(RECENTS_KEY);

    function updateFavoriteButtons() {
      favoriteButtons.forEach(function (button) {
        var id = button.dataset.favoriteTool;
        var active = favorites.has(id);
        button.textContent = active ? '★' : '☆';
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', (active ? 'Remove ' : 'Add ') + id.replace(/-/g, ' ') + (active ? ' from favorites' : ' to favorites'));
        button.classList.toggle('active', active);
      });
      if (favoritesCount) favoritesCount.textContent = String(favorites.size);
    }

    function matchesFilter(card) {
      var id = card.dataset.toolId;
      var category = card.dataset.category;
      if (activeFilter === 'favorites') return favorites.has(id);
      if (activeFilter === 'recent') return recents.indexOf(id) !== -1;
      if (activeFilter.indexOf('category:') === 0) return category === activeFilter.slice(9);
      return true;
    }

    function apply() {
      var query = String(search && search.value || '').trim().toLowerCase();
      var visible = 0;
      cards.forEach(function (card) {
        var searchText = String(card.dataset.search || '');
        var show = matchesFilter(card) && (!query || searchText.indexOf(query) !== -1);
        card.classList.toggle('hidden', !show);
        if (show) visible++;
      });

      if (activeFilter === 'recent' && !query) {
        cards.sort(function (a, b) {
          var ai = recents.indexOf(a.dataset.toolId);
          var bi = recents.indexOf(b.dataset.toolId);
          ai = ai === -1 ? 999 : ai;
          bi = bi === -1 ? 999 : bi;
          return ai - bi;
        }).forEach(function (card) { catalog.appendChild(card); });
      }

      if (count) count.textContent = visible + ' tool' + (visible === 1 ? '' : 's') + ' shown';
      if (empty) empty.classList.toggle('hidden', visible !== 0);
    }

    filters.forEach(function (button) {
      button.addEventListener('click', function () {
        activeFilter = button.dataset.filter || 'all';
        filters.forEach(function (candidate) {
          var selected = candidate === button;
          candidate.classList.toggle('active', selected);
          candidate.setAttribute('aria-pressed', String(selected));
        });
        apply();
      });
    });

    if (search) {
      search.addEventListener('input', apply);
      document.addEventListener('keydown', function (event) {
        if (event.key === '/' && document.activeElement !== search && !/input|textarea|select/i.test(document.activeElement && document.activeElement.tagName || '')) {
          event.preventDefault();
          search.focus();
        }
      });
    }

    favoriteButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.dataset.favoriteTool;
        if (favorites.has(id)) favorites.delete(id);
        else favorites.add(id);
        writeList(FAVORITES_KEY, Array.from(favorites));
        updateFavoriteButtons();
        apply();
      });
    });

    toolLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        var id = link.dataset.toolId;
        recents = [id].concat(recents.filter(function (value) { return value !== id; })).slice(0, MAX_RECENTS);
        writeList(RECENTS_KEY, recents);
      });
    });

    updateFavoriteButtons();
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
