/**
 * Settings persistence via localStorage
 */
const Settings = {
  STORAGE_KEY: 'devtoolkit_settings',

  defaults: {
    imgFormat: 'webp',
    imgQuality: 80,
    pdfLevel: 'ebook',
    mangle: 'true',
    showTour: 'true'
  },

  load() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || { ...this.defaults }; }
    catch { return { ...this.defaults }; }
  },

  save() {
    const data = {};
    Object.keys(this.defaults).forEach(key => {
      const el = document.getElementById('s-' + key);
      if (el) data[key] = el.value;
    });
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    if (typeof Toast !== 'undefined') Toast.success('Settings saved');
  },

  reset() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.defaults));
    this.applyToForm();
    if (typeof Toast !== 'undefined') Toast.info('Settings reset to defaults');
  },

  applyToForm() {
    const data = this.load();
    Object.keys(data).forEach(key => {
      const el = document.getElementById('s-' + key);
      if (el) el.value = data[key];
    });
  },

  // Apply saved settings to tool pages (call on tool pages)
  applyToTool() {
    const data = this.load();
    const map = { imgFormat: 'targetFormat', imgQuality: 'quality', pdfLevel: 'compressionLevel', mangle: 'mangle' };
    Object.entries(map).forEach(([sKey, elId]) => {
      const el = document.getElementById(elId);
      if (el && data[sKey] !== undefined) el.value = data[sKey];
    });
  }
};

// Auto-apply: on settings page populate form, on tool pages apply defaults
function initSettings() {
  if (document.getElementById('s-imgFormat')) Settings.applyToForm();
  else Settings.applyToTool();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSettings);
} else {
  initSettings();
}
