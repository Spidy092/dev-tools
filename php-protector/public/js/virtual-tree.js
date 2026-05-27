/**
 * Virtual scrolling file tree — only renders visible rows.
 * Handles 10k+ files without freezing the browser.
 */
const VirtualTree = {
  ROW_HEIGHT: 28,
  OVERSCAN: 10,
  _container: null,
  _viewport: null,
  _spacer: null,
  _items: [],       // [{path, ext, excluded, checked, idx}]
  _scrollTop: 0,

  init(containerEl) {
    this._container = containerEl;
    this._container.innerHTML = '';
    this._container.style.position = 'relative';
    this._container.style.overflow = 'auto';

    this._spacer = document.createElement('div');
    this._spacer.style.position = 'relative';
    this._container.appendChild(this._spacer);

    this._container.addEventListener('scroll', () => {
      this._scrollTop = this._container.scrollTop;
      this._render();
    });

    // Delegate checkbox clicks
    this._container.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') {
        const idx = parseInt(e.target.dataset.idx);
        if (!isNaN(idx)) this._items[idx].checked = e.target.checked;
      }
    });
  },

  setItems(items) {
    this._items = items;
    this._spacer.style.height = (items.length * this.ROW_HEIGHT) + 'px';
    this._scrollTop = this._container.scrollTop;
    this._render();
  },

  getCheckedIndices() {
    return this._items.filter(it => it.checked).map(it => it.idx);
  },

  _render() {
    const viewH = this._container.clientHeight;
    const startIdx = Math.max(0, Math.floor(this._scrollTop / this.ROW_HEIGHT) - this.OVERSCAN);
    const endIdx = Math.min(this._items.length, Math.ceil((this._scrollTop + viewH) / this.ROW_HEIGHT) + this.OVERSCAN);

    // Remove old rows except spacer
    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      const item = this._items[i];
      const row = document.createElement('div');
      row.className = item.excluded ? 'ft-file ft-excluded' : (item.ext === 'php' ? 'ft-file ft-php' : 'ft-file');
      row.style.position = 'absolute';
      row.style.top = (i * this.ROW_HEIGHT) + 'px';
      row.style.left = '0';
      row.style.right = '0';
      row.style.height = this.ROW_HEIGHT + 'px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.innerHTML = '';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.idx = i;
      cb.checked = item.checked;
      const span = document.createElement('span');
      span.textContent = item.path;
      row.append(cb, span);
      frag.appendChild(row);
    }

    // Clear rendered rows (keep spacer)
    while (this._spacer.firstChild) this._spacer.removeChild(this._spacer.firstChild);
    this._spacer.appendChild(frag);
  }
};
