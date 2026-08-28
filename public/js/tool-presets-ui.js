/* Browser UI for per-tool presets. */
(function () {
  function initPresetUi() {
    var workspace = document.querySelector('.workspace[data-tool-id]');
    var optionsPanel = document.getElementById('options-panel');
    var api = window.DevToolkitPresets;
    if (!workspace || !optionsPanel || !api) return;

    var toolId = workspace.dataset.toolId;
    var storageKey = api.storageKey(toolId);
    var presets = loadPresets();

    var host = document.createElement('section');
    host.className = 'preset-panel';
    host.setAttribute('aria-label', 'Saved presets');
    host.innerHTML = '<div class="preset-heading"><div><p class="queue-eyebrow">Reusable settings</p><h2>Presets</h2><p class="preset-subtitle">Save this tool\'s settings in your browser or share them as a JSON preset file.</p></div><div class="preset-actions"><label class="secondary-action compact">Import<input type="file" id="preset-import-input" accept="application/json,.json"></label><button type="button" class="secondary-action compact" id="preset-export-btn">Export selected</button></div></div><div class="preset-controls"><div class="preset-select-wrap"><label for="preset-select">Saved preset</label><select id="preset-select"><option value="">Choose a saved preset…</option></select></div><button type="button" class="secondary-action compact" id="preset-apply-btn">Apply</button><button type="button" class="queue-link-btn danger" id="preset-delete-btn">Delete</button></div><div class="preset-save-row"><div><label for="preset-name">Save current settings</label><input id="preset-name" type="text" maxlength="80" placeholder="e.g. Website Production Images" autocomplete="off"></div><button type="button" class="browse-btn" id="preset-save-btn">Save preset</button></div><p class="preset-note">Presets contain settings only—never selected files. Applying a preset updates the preview before processing.</p>';
    optionsPanel.parentNode.insertBefore(host, optionsPanel);

    var select = host.querySelector('#preset-select');
    var nameInput = host.querySelector('#preset-name');
    var saveBtn = host.querySelector('#preset-save-btn');
    var applyBtn = host.querySelector('#preset-apply-btn');
    var deleteBtn = host.querySelector('#preset-delete-btn');
    var exportBtn = host.querySelector('#preset-export-btn');
    var importInput = host.querySelector('#preset-import-input');

    function toast(method, message) {
      if (typeof Toast !== 'undefined' && Toast[method]) Toast[method](message);
    }

    function loadPresets() {
      try {
        var raw = localStorage.getItem(storageKey);
        return raw ? api.normalizeList(JSON.parse(raw), toolId) : [];
      } catch (_error) {
        try { localStorage.removeItem(storageKey); } catch (_) {}
        return [];
      }
    }

    function persist(preferredId) {
      localStorage.setItem(storageKey, JSON.stringify(presets));
      renderSelect(preferredId);
    }

    function renderSelect(preferredId) {
      var current = preferredId || select.value;
      select.replaceChildren();
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = presets.length ? 'Choose a saved preset…' : 'No presets saved yet';
      select.appendChild(placeholder);
      presets.forEach(function (preset) {
        var option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        select.appendChild(option);
      });
      if (current && presets.some(function (preset) { return preset.id === current; })) select.value = current;
      syncButtons();
    }

    function syncButtons() {
      var selected = Boolean(select.value);
      applyBtn.disabled = !selected;
      deleteBtn.disabled = !selected;
      exportBtn.disabled = !selected;
    }

    function collectOptions() {
      var options = {};
      optionsPanel.querySelectorAll('input, select, textarea').forEach(function (input) {
        if (!input.id || input.type === 'file' || input.disabled) return;
        if (input.type === 'checkbox' || input.type === 'radio') options[input.id] = input.checked;
        else options[input.id] = input.value;
      });
      return options;
    }

    function applyOptions(options) {
      Object.keys(options || {}).forEach(function (id) {
        var input = document.getElementById(id);
        if (!input || !optionsPanel.contains(input) || input.type === 'file') return;
        var value = options[id];
        if (input.type === 'checkbox' || input.type === 'radio') input.checked = Boolean(value);
        else input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    function selectedPreset() {
      return presets.find(function (preset) { return preset.id === select.value; }) || null;
    }

    function safeFilename(name) {
      return String(name || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'preset';
    }

    function downloadJson(filename, content) {
      var blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    }

    saveBtn.addEventListener('click', function () {
      try {
        var name = nameInput.value;
        var existing = presets.find(function (preset) { return preset.name.toLowerCase() === name.trim().toLowerCase(); });
        var preset = api.createPreset(toolId, name, collectOptions(), existing && existing.id);
        presets = api.upsertPreset(presets, preset);
        persist(preset.id);
        nameInput.value = '';
        toast('success', existing ? 'Preset updated.' : 'Preset saved locally.');
      } catch (error) { toast('error', error.message); }
    });

    select.addEventListener('change', syncButtons);
    applyBtn.addEventListener('click', function () {
      var preset = selectedPreset(); if (!preset) return;
      applyOptions(preset.options);
      toast('success', 'Preset applied: ' + preset.name + '. Preview changes before processing.');
    });
    deleteBtn.addEventListener('click', function () {
      var preset = selectedPreset(); if (!preset) return;
      presets = presets.filter(function (item) { return item.id !== preset.id; });
      persist(); toast('info', 'Preset deleted.');
    });
    exportBtn.addEventListener('click', function () {
      var preset = selectedPreset(); if (!preset) return;
      downloadJson('devtoolkit-' + toolId + '-' + safeFilename(preset.name) + '.json', api.serializePreset(preset));
      toast('info', 'Preset exported.');
    });
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!file) return;
      if (file.size > 256 * 1024) return toast('error', 'Preset file is too large.');
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var bundle = api.parseBundle(reader.result, toolId);
          bundle.presets.forEach(function (preset) { presets = api.upsertPreset(presets, preset); });
          persist();
          toast('success', bundle.presets.length + ' preset' + (bundle.presets.length === 1 ? '' : 's') + ' imported.');
        } catch (error) { toast('error', error.message); }
      };
      reader.onerror = function () { toast('error', 'Could not read preset file.'); };
      reader.readAsText(file);
    });

    renderSelect();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPresetUi);
  else initPresetUi();
})();
