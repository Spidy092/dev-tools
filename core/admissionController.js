class AdmissionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AdmissionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeRequest(jobId, request, limits) {
  const id = String(jobId || '').trim();
  if (!id) throw new AdmissionError('INVALID_JOB_ID', 'Admission requires a job identifier.');

  const units = boundedInteger(request?.units, 1, 1, 64);
  const bytes = Number(request?.bytes ?? 0);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new AdmissionError('INVALID_ADMISSION_BYTES', 'Admission byte cost must be a non-negative safe integer.');
  }
  if (units > limits.maxActiveUnits) {
    throw new AdmissionError('JOB_EXCEEDS_CAPACITY', 'Job requires more processing units than this instance can provide.', {
      units,
      maxActiveUnits: limits.maxActiveUnits
    });
  }
  if (bytes > limits.maxActiveBytes) {
    throw new AdmissionError('JOB_EXCEEDS_CAPACITY', 'Job exceeds this instance\'s active processing byte capacity.', {
      bytes,
      maxActiveBytes: limits.maxActiveBytes
    });
  }

  return {
    jobId: id,
    units,
    bytes,
    kind: String(request?.kind || 'default').slice(0, 64),
    signal: request?.signal,
    onQueued: typeof request?.onQueued === 'function' ? request.onQueued : null,
    onPosition: typeof request?.onPosition === 'function' ? request.onPosition : null,
    onAdmitted: typeof request?.onAdmitted === 'function' ? request.onAdmitted : null
  };
}

class AdmissionController {
  constructor(options = {}) {
    this.limits = Object.freeze({
      maxActiveJobs: boundedInteger(options.maxActiveJobs, 4, 1, 128),
      maxActiveUnits: boundedInteger(options.maxActiveUnits, 8, 1, 256),
      maxActiveBytes: boundedInteger(options.maxActiveBytes, 1024 * 1024 * 1024, 1, Number.MAX_SAFE_INTEGER),
      maxQueuedJobs: boundedInteger(options.maxQueuedJobs, 16, 0, 10000),
      maxQueuedBytes: boundedInteger(options.maxQueuedBytes, 2 * 1024 * 1024 * 1024, 0, Number.MAX_SAFE_INTEGER),
      maxWaitMs: boundedInteger(options.maxWaitMs, 120000, 1000, 60 * 60 * 1000),
      maxBypasses: boundedInteger(options.maxBypasses, 3, 0, 100)
    });
    this.active = new Map();
    this.queue = [];
    this.queuedBytes = 0;
    this.activeBytes = 0;
    this.activeUnits = 0;
    this.sequence = 0;
    this.draining = false;
    this.closed = false;
    this.closeReason = '';
  }

  canRun(entry) {
    return !this.closed &&
      this.active.size < this.limits.maxActiveJobs &&
      this.activeUnits + entry.units <= this.limits.maxActiveUnits &&
      this.activeBytes + entry.bytes <= this.limits.maxActiveBytes;
  }

  assertUnique(jobId) {
    if (this.active.has(jobId) || this.queue.some(entry => entry.jobId === jobId)) {
      throw new AdmissionError('DUPLICATE_ADMISSION', 'Job is already admitted or queued.');
    }
  }

  acquire(jobId, request = {}) {
    if (this.closed) {
      return Promise.reject(new AdmissionError('ADMISSION_SHUTDOWN', `Processing queue is closed: ${this.closeReason || 'shutdown'}.`));
    }

    const normalized = normalizeRequest(jobId, request, this.limits);
    this.assertUnique(normalized.jobId);

    if (normalized.signal?.aborted) {
      return Promise.reject(new AdmissionError('ADMISSION_ABORTED', 'Admission was cancelled before it started.'));
    }

    if (this.canRun(normalized) && this.queue.length === 0) {
      return Promise.resolve(this.activate(normalized));
    }

    if (this.limits.maxQueuedJobs === 0 || this.queue.length >= this.limits.maxQueuedJobs) {
      return Promise.reject(new AdmissionError('ADMISSION_QUEUE_FULL', 'Processing queue is full.', this.snapshot()));
    }
    if (this.queuedBytes + normalized.bytes > this.limits.maxQueuedBytes) {
      return Promise.reject(new AdmissionError('ADMISSION_QUEUE_BYTES_FULL', 'Processing queue byte budget is full.', this.snapshot()));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        ...normalized,
        sequence: ++this.sequence,
        queuedAt: Date.now(),
        bypasses: 0,
        resolve,
        reject,
        timer: null,
        abortListener: null,
        settled: false
      };

      const removeAndReject = error => {
        if (entry.settled) return;
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
          this.queue.splice(index, 1);
          this.queuedBytes -= entry.bytes;
        }
        this.cleanupEntry(entry);
        entry.settled = true;
        reject(error);
        this.notifyQueuePositions();
        this.scheduleDrain();
      };

      entry.timer = setTimeout(() => {
        removeAndReject(new AdmissionError('ADMISSION_WAIT_TIMEOUT', 'Processing queue wait timed out.', {
          waitedMs: Date.now() - entry.queuedAt,
          ...this.snapshot()
        }));
      }, this.limits.maxWaitMs);
      entry.timer.unref?.();

      if (entry.signal) {
        entry.abortListener = () => removeAndReject(new AdmissionError('ADMISSION_ABORTED', 'Queued processing was cancelled.'));
        entry.signal.addEventListener('abort', entry.abortListener, { once: true });
      }

      this.queue.push(entry);
      this.queuedBytes += entry.bytes;
      entry.onQueued?.({
        position: this.queue.length,
        queuedJobs: this.queue.length,
        queuedBytes: this.queuedBytes,
        units: entry.units,
        bytes: entry.bytes
      });
      this.scheduleDrain();
    });
  }

  cleanupEntry(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.signal && entry.abortListener) entry.signal.removeEventListener('abort', entry.abortListener);
    entry.timer = null;
    entry.abortListener = null;
  }

  notifyQueuePositions() {
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      entry.onPosition?.({
        position: i + 1,
        queuedJobs: this.queue.length,
        queuedBytes: this.queuedBytes,
        waitedMs: Math.max(0, Date.now() - entry.queuedAt)
      });
    }
  }

  activate(request) {
    if (this.closed) {
      throw new AdmissionError('ADMISSION_SHUTDOWN', `Processing queue is closed: ${this.closeReason || 'shutdown'}.`);
    }
    const entry = {
      jobId: request.jobId,
      units: request.units,
      bytes: request.bytes,
      kind: request.kind,
      admittedAt: Date.now(),
      released: false
    };
    this.active.set(entry.jobId, entry);
    this.activeUnits += entry.units;
    this.activeBytes += entry.bytes;
    request.onAdmitted?.({
      activeJobs: this.active.size,
      activeUnits: this.activeUnits,
      activeBytes: this.activeBytes,
      units: entry.units,
      bytes: entry.bytes
    });

    const release = () => {
      if (entry.released) return false;
      entry.released = true;
      const current = this.active.get(entry.jobId);
      if (current === entry) {
        this.active.delete(entry.jobId);
        this.activeUnits = Math.max(0, this.activeUnits - entry.units);
        this.activeBytes = Math.max(0, this.activeBytes - entry.bytes);
        this.scheduleDrain();
        return true;
      }
      return false;
    };

    return Object.freeze({
      jobId: entry.jobId,
      units: entry.units,
      bytes: entry.bytes,
      kind: entry.kind,
      admittedAt: entry.admittedAt,
      release
    });
  }

  chooseNextIndex() {
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      if (this.canRun(entry)) {
        for (let skipped = 0; skipped < i; skipped++) this.queue[skipped].bypasses += 1;
        return i;
      }
      if (entry.bypasses >= this.limits.maxBypasses) return -1;
    }
    return -1;
  }

  drain() {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const index = this.chooseNextIndex();
        if (index < 0) break;
        const entry = this.queue.splice(index, 1)[0];
        this.queuedBytes -= entry.bytes;
        this.cleanupEntry(entry);
        this.notifyQueuePositions();
        if (entry.signal?.aborted) {
          entry.settled = true;
          entry.reject(new AdmissionError('ADMISSION_ABORTED', 'Queued processing was cancelled.'));
          continue;
        }
        entry.settled = true;
        try {
          entry.resolve(this.activate(entry));
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  scheduleDrain() {
    if (this.draining || this.closed) return;
    queueMicrotask(() => this.drain());
  }

  cancelQueued(jobId, reason = 'cancelled') {
    const index = this.queue.findIndex(entry => entry.jobId === jobId);
    if (index < 0) return false;
    const entry = this.queue.splice(index, 1)[0];
    this.queuedBytes -= entry.bytes;
    this.cleanupEntry(entry);
    entry.settled = true;
    entry.reject(new AdmissionError('ADMISSION_ABORTED', `Queued processing ${reason}.`));
    this.notifyQueuePositions();
    this.scheduleDrain();
    return true;
  }

  shutdown(reason = 'shutdown') {
    if (this.closed) return 0;
    this.closed = true;
    this.closeReason = String(reason || 'shutdown');
    const queued = this.queue.splice(0, this.queue.length);
    this.queuedBytes = 0;
    for (const entry of queued) {
      this.cleanupEntry(entry);
      entry.settled = true;
      entry.reject(new AdmissionError('ADMISSION_SHUTDOWN', `Processing queue closed: ${this.closeReason}.`));
    }
    return queued.length;
  }

  snapshot() {
    const now = Date.now();
    const oldest = this.queue.length ? Math.max(0, now - this.queue[0].queuedAt) : 0;
    const activeKinds = {};
    const queuedKinds = {};
    for (const entry of this.active.values()) activeKinds[entry.kind] = (activeKinds[entry.kind] || 0) + 1;
    for (const entry of this.queue) queuedKinds[entry.kind] = (queuedKinds[entry.kind] || 0) + 1;
    return {
      accepting: !this.closed && this.queue.length < this.limits.maxQueuedJobs && this.queuedBytes < this.limits.maxQueuedBytes,
      closed: this.closed,
      closeReason: this.closed ? this.closeReason : null,
      active: {
        jobs: this.active.size,
        units: this.activeUnits,
        bytes: this.activeBytes,
        kinds: activeKinds
      },
      queued: {
        jobs: this.queue.length,
        bytes: this.queuedBytes,
        oldestWaitMs: oldest,
        kinds: queuedKinds
      },
      limits: { ...this.limits }
    };
  }
}

module.exports = {
  AdmissionController,
  AdmissionError
};
