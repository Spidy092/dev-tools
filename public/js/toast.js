/**
 * Toast notification system — replaces alert() calls
 */
const Toast = {
  _container: null,
  _icons: { success: '✓', error: '✕', info: 'ℹ' },

  _getContainer() {
    if (!this._container) this._container = document.getElementById('toast-container');
    return this._container;
  },

  show(message, type = 'info', duration = 4000) {
    const container = this._getContainer();
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = this._icons[type] || 'ℹ';

    const msg = document.createElement('span');
    msg.className = 'toast-msg';
    msg.textContent = message;

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.textContent = '×';
    close.addEventListener('click', () => el.remove());

    el.append(icon, msg, close);
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add('show'));
    if (duration > 0) setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
  },

  success(msg, dur) { this.show(msg, 'success', dur); },
  error(msg, dur) { this.show(msg, 'error', dur || 6000); },
  info(msg, dur) { this.show(msg, 'info', dur); }
};
