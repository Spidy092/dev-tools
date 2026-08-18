/* Browser UI for per-tool presets. */
(function () {
  function initPresetUi() {
    var workspace = document.querySelector('.workspace[data-tool-id]');
    var optionsPanel = document.getElementById('options-panel');
    if (!workspace || !optionsPanel || !window.DevToolkitPresets) return;

    var toolId = workspace.dataset.toolId;
    var storageKey = window.DevToolkitPresets.storageKey(toolId);
    var presets = loadPresets();

    var host = document.createElement('section');
    host.className = 'preset-panel';
    host.innerHTML = '<div class="preset-heading"><div><p class="queue-eyebrow">Reusable settings</p><h2>Presets</h2><p class="preset-subtitle">Save this tool\'s settings in your browser or share them as a JSON preset file.</p></div><div class="preset-actions"><button type="button" class="secondary-action compact" id="preset-save-btn">Save current</button><button type="button" class="secondary-action compact" id="preset-export-btn">Export</button><label class="secondary-action compact">Import<input type="file" id="preset-import-input" accept="application/json,.json"></label></div></div><div class="preset-controls"><label class="sr-only" for="preset-select">Saved presets</label><select id="preset-select"><option value="">Choose a saved preset…</option></select><button type="button" class="secondary-action compact" id="preset-apply-btn">Apply</button><button type="button" class="queue-link-btn danger" id="preset-delete-btn">Delete</button></div>';
    optionsPanel.prepend(host);

    var select = document.getElementById('preset-select');
    var saveBtn = document.getElementById('preset-save-btn');
    var applyBtn = document.getElementById('preset-apply-btn');
    var deleteBtn = document.getElementById('preset-delete-btn');
    var exportBtn = document.getElementById('preset-export-btn');
    var importInput = document.getElementById('preset-import-input');

    function toast(method, message) {
      if (typeof Toast !== 'undefined' && Toast[method]) Toast[method](message);
    }

    function loadPresets() {
      try {
        var raw = localStorage.getItem(storageKey);
        return raw ? window.DevToolkitPresets.normalizeList(JSON.parse(raw), toolId) : [];
      } catch (_error) {
        return [];
      }
    }

    function persist() {
      localStorage.setItem(storageKey, JSON.stringify(presets));
      renderSelect();
    }

    function renderSelect() {
      var current = select.value;
      select.replaceChildren();
      var placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = presets.length ? 'Choose a saved preset…' : 'No presets saved yet'; select.appendChild(placeholder);
      presets.forEach(function (preset) { var option = document.createElement('option'); option.value = preset.id; option.textContent = preset.name; select.appendChild(option); });
      if (presets.some(function (preset) { return preset.id === current; })) select.value = current;
      applyBtn.disabled = !select.value;
      deleteBtn.disabled = !select.value;
    }

    function collectOptions() {
      var options = {};
      optionsPanel.querySelectorAll('input, select, textarea').forEach(function (input) {
        if (!input.id || input.closest('.preset-panel') || input.type === 'file' || input.disabled) return;
        options[input.id] = input.type === 'checkbox' ? input.checked : input.value;
      });
      return options;
    }

    function applyOptions(options) {
      Object.keys(options || {}).forEach(function (id) {
        var input = document.getElementById(id);
        if (!input || input.closest('.preset-panel') || input.type === 'file') return;
        var value = options[id];
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = String(value);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    function selectedPreset() {
      return presets.find(function (preset) { return preset.id === select.value; }) || null;
    }

    saveBtn.addEventListener('click', function () {
      var name = window.prompt('Preset name', 'My ' + toolId.replace(/-/g, ' ') + ' preset');
      if (name == null) return;
      try {
        var preset = window.DevToolkitPresets.createPreset(toolId, name, collectOptions());
        presets = window.DevToolkitPresets.upsertPreset(presets, preset);
        persist(); select.value = presets[0].id; renderSelect(); toast('success', 'Preset saved locally.');
      } catch (error) { toast('error', error.message); }
    });

    select.addEventListener('change', function () { applyBtn.disabled = !select.value; deleteBtn.disabled = !select.value; });
    applyBtn.addEventListener('click', function () {
      var preset = selectedPreset(); if (!preset) return;
      applyOptions(preset.options); toast('success', 'Preset applied: ' + preset.name);
    });
    deleteBtn.addEventListener('click', function () {
      var preset = selectedPreset(); if (!preset) return;
      presets = presets.filter(function (item) { return item.id !== preset.id; }); persist(); toast('info', 'Preset deleted.');
    });
    exportBtn.addEventListener('click', function () {
      if (!presets.length) return toast('error', 'Save at least one preset before exporting.');
      var preset = selectedPreset() || presets[0];
      var blob = new Blob([window.DevToolkitPresets.serializePreset(preset)], { type: 'application/json' });
      var url = URL.createObjectURL(blob); var link = document.createElement('a'); link.href = url; link.download = toolId + '-' + preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      toast('info', 'Preset exported.');
    });
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var bundle = window.DevToolkitPresets.parseBundle(reader.result, toolId);
          bundle.presets.forEach(function (preset) { presets = window.DevToolkitPresets.upsertPreset(presets, preset); });
          persist(); toast('success', bundle.presets.length + ' preset' + (bundle.presets.length === 1 ? '' : 's') + ' imported.');
        } catch (error) { toast('error', error.message); }
        importInput.value = '';
      };
      reader.readAsText(file);
    });

    renderSelect();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPresetUi); else initPresetUi();
})();
