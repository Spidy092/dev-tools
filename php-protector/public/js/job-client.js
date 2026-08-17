(function () {
  var nativeFetch = window.fetch.bind(window);
  var activeJobId = '';
  var activeRequestKey = '';
  var processing = false;

  function randomHex(bytes) {
    var values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return Array.from(values).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
  }

  function endpointUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function isProcessingRequest(input, init) {
    var method = String(init && init.method || 'GET').toUpperCase();
    var url = endpointUrl(input);
    return method === 'POST' && window.toolEndpoint && url === window.toolEndpoint;
  }

  function fnvHex(value, seed) {
    var hash = seed >>> 0;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function stableRequestKey(endpoint, body) {
    var parts = [endpoint];
    if (body && typeof body.forEach === 'function') {
      body.forEach(function (value, key) {
        if (typeof File !== 'undefined' && value instanceof File) {
          parts.push(key + ':file:' + value.name + ':' + value.size + ':' + value.lastModified);
        } else {
          parts.push(key + ':' + String(value));
        }
      });
    }
    var source = parts.join('|');
    return fnvHex(source, 2166136261) + fnvHex(source, 2246822519) + fnvHex(source, 3266489917) + fnvHex(source, 668265263);
  }

  function updateCancelButton() {
    var button = document.getElementById('cancel-job-btn');
    if (!button) return;
    button.disabled = !processing || !activeJobId;
    button.classList.toggle('hidden', !processing);
    if (!button.disabled) button.textContent = 'Cancel processing';
  }

  function createJobContext(endpoint, body) {
    activeJobId = randomHex(16);
    activeRequestKey = stableRequestKey(endpoint, body);
    processing = true;
    updateCancelButton();
    return { jobId: activeJobId, requestKey: activeRequestKey };
  }

  function clearJobContext(jobId) {
    if (jobId && activeJobId && jobId !== activeJobId) return;
    processing = false;
    activeJobId = '';
    activeRequestKey = '';
    updateCancelButton();
  }

  function wrapResponseConsumption(response, contextJobId) {
    ['blob', 'text', 'arrayBuffer', 'json'].forEach(function (method) {
      if (typeof response[method] !== 'function') return;
      var original = response[method].bind(response);
      try {
        response[method] = async function () {
          try { return await original(); }
          finally { clearJobContext(contextJobId); }
        };
      } catch (_error) {}
    });
    return response;
  }

  window.fetch = function (input, init) {
    if (!isProcessingRequest(input, init)) return nativeFetch(input, init);

    var endpoint = endpointUrl(input);
    var context = createJobContext(endpoint, init && init.body);
    var nextInit = Object.assign({}, init || {});
    var headers = new Headers(nextInit.headers || {});
    headers.set('X-Job-Id', context.jobId);
    headers.set('X-Request-Key', context.requestKey);
    nextInit.headers = headers;

    return nativeFetch(input, nextInit).then(function (response) {
      var serverJobId = response.headers.get('X-Job-Id');
      if (serverJobId) activeJobId = serverJobId;
      updateCancelButton();
      return wrapResponseConsumption(response, activeJobId || context.jobId);
    }).catch(function (error) {
      clearJobContext(context.jobId);
      throw error;
    });
  };

  async function cancelActiveJob() {
    if (!activeJobId || !processing) return;
    var button = document.getElementById('cancel-job-btn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Cancelling…';
    }
    try {
      var response = await nativeFetch('/progress/' + encodeURIComponent(activeJobId) + '/cancel', { method: 'POST' });
      if (!response.ok && response.status !== 409) throw new Error('Cancel request failed');
      if (typeof Toast !== 'undefined' && Toast.info) Toast.info('Cancellation requested. The current file may finish before processing stops.');
    } catch (error) {
      console.error(error);
      if (typeof Toast !== 'undefined' && Toast.error) Toast.error('Could not cancel this job.');
      if (button) {
        button.disabled = false;
        button.textContent = 'Cancel processing';
      }
    }
  }

  function init() {
    var button = document.getElementById('cancel-job-btn');
    if (button) button.addEventListener('click', cancelActiveJob);
    updateCancelButton();
  }

  window.DevToolkitJobs = {
    getActiveJobId: function () { return activeJobId; },
    markFinished: clearJobContext
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
