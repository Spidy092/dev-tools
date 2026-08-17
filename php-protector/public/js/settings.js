/** Settings persistence via localStorage. */
const Settings = {
  STORAGE_KEY: 'devtoolkit_settings',

  defaults: {
    imgFormat: 'webp',
    imgQuality: 80,
    pdfLevel: '/ebook',
    mangle: 'true',
    showTour: 'true'
  },

  load() {
    try {
      return { ...this.defaults, ...(JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {}) };
    } catch {
      return { ...this.defaults };
    }
  },

  save() {
    const data = { ...this.defaults };
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

  applyToTool() {
    const data = this.load();
    const targets = {
      imgFormat: ['targetFormat'],
      imgQuality: ['quality', 'customQuality'],
      pdfLevel: ['pdfLevel'],
      mangle: ['mangleVariables']
    };

    Object.entries(targets).forEach(([settingKey, ids]) => {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el || data[settingKey] === undefined) return;
        if (el.type === 'checkbox') el.checked = String(data[settingKey]) === 'true';
        else el.value = data[settingKey];
      });
    });
  }
};

function initSettings() {
  if (document.getElementById('s-imgFormat')) Settings.applyToForm();
  else Settings.applyToTool();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSettings);
else initSettings();
