const { AdmissionController, AdmissionError } = require('../core/admissionController');
const { RESOURCE_POLICY, MiB, totalDeclaredBytes } = require('../core/resourcePolicy');
const {
  setJobStatus,
  endProgress,
  getJobSignal,
  throwIfCancelled,
  JobCancelledError
} = require('./routes/progress');

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

const controller = new AdmissionController({
  maxActiveJobs: boundedNumber(process.env.MAX_ACTIVE_PROCESSING_JOBS, 4, 1, 32),
  maxActiveUnits: boundedNumber(process.env.MAX_ACTIVE_PROCESSING_UNITS, 8, 1, 64),
  maxActiveBytes: boundedNumber(process.env.MAX_ACTIVE_PROCESSING_MB, Math.ceil(RESOURCE_POLICY.coreBatchBytes / MiB), 1, 4096) * MiB,
  maxQueuedJobs: boundedNumber(process.env.MAX_QUEUED_PROCESSING_JOBS, 16, 0, 256),
  maxQueuedBytes: boundedNumber(process.env.MAX_QUEUED_PROCESSING_MB, 2048, 0, 8192) * MiB,
  maxWaitMs: boundedNumber(process.env.ADMISSION_MAX_WAIT_MS, 120000, 1000, 15 * 60 * 1000),
  maxBypasses: boundedNumber(process.env.ADMISSION_MAX_BYPASSES, 3, 0, 20)
});

const BASE_UNITS = Object.freeze({
  stream: 1,
  checksum: 1,
  duplicate: 2,
  text: 2,
  php: 2,
  code: 3,
  image: 4,
  pdf: 4
});

function requestPath(req) {
  return String(req?.originalUrl || req?.url || '').split('?')[0];
}

function kindForRequest(req) {
  if (String(req?.method || '').toUpperCase() !== 'POST') return null;
  const pathname = requestPath(req);
  if (pathname === '/upload') return 'php';
  if (pathname.startsWith('/image-tools/')) return 'image';
  if (pathname.startsWith('/image-compressor-tools/')) return 'image';
  if (pathname.startsWith('/pdf-tools/')) return 'pdf';
  if (pathname.startsWith('/minify-tools/')) return 'code';
  if (pathname.startsWith('/file-tools/checksums/')) return 'checksum';
  if (pathname === '/file-tools/duplicates') return 'duplicate';
  if (pathname === '/file-tools/normalize-text') return 'text';
  if (pathname === '/file-tools/rename') return 'stream';
  return null;
}

function estimateAdmission(kind, files) {
  const list = Array.isArray(files) ? files : [];
  const bytes = totalDeclaredBytes(list, RESOURCE_POLICY.coreBatchBytes);
  const base = BASE_UNITS[kind] || 2;
  const byteUnits = bytes >= 384 * MiB ? 2 : bytes >= 128 * MiB ? 1 : 0;
  const fileUnits = list.length >= 3000 ? 2 : list.length >= 1000 ? 1 : 0;
  const maxUnits = controller.snapshot().limits.maxActiveUnits;
  const units = Math.min(maxUnits, Math.max(1, base + byteUnits + fileUnits));
  return { kind, units, bytes, files: list.length };
}

function retryAfter(res, seconds = 5) {
  res.setHeader('Retry-After', String(Math.max(1, Math.floor(seconds))));
  res.setHeader('Cache-Control', 'no-store');
}

function preflightAdmission() {
  return (req, res, next) => {
    if (!kindForRequest(req)) return next();
    const state = controller.snapshot();
    if (!state.accepting) {
      retryAfter(res);
      return res.status(503).json({
        error: 'Processing queue is full. Please retry shortly.',
        code: 'ADMISSION_QUEUE_FULL'
      });
    }
    next();
  };
}

function releaseOnce(lease) {
  let released = false;
  return () => {
    if (released) return false;
    released = true;
    return lease.release();
  };
}

function admissionMiddleware(kind) {
  return async (req, res, next) => {
    const jobId = req.jobId;
    let cost;
    try {
      throwIfCancelled(jobId);
      cost = estimateAdmission(kind, req.files || []);
    } catch (error) {
      if (error instanceof JobCancelledError) {
        endProgress(jobId, 'cancelled');
        return res.status(499).json({ error: error.message });
      }
      endProgress(jobId, 'failed', { reason: error.code || 'resource-policy' });
      const status = error.code === 'CORE_BATCH_LIMIT' ? 413 : 400;
      return res.status(status).json({ error: error.message || 'Invalid processing workload.' });
    }

    const signal = getJobSignal(jobId);
    try {
      const lease = await controller.acquire(jobId, {
        ...cost,
        signal,
        onQueued: queue => setJobStatus(jobId, 'queued', {
          admission: {
            kind,
            units: cost.units,
            bytes: cost.bytes,
            files: cost.files,
            position: queue.position,
            queuedAt: Date.now()
          },
          event: { position: queue.position, queuedJobs: queue.queuedJobs }
        }),
        onAdmitted: active => setJobStatus(jobId, 'running', {
          admission: {
            kind,
            units: cost.units,
            bytes: cost.bytes,
            files: cost.files,
            admittedAt: Date.now()
          },
          event: { activeJobs: active.activeJobs, activeUnits: active.activeUnits }
        })
      });

      const release = releaseOnce(lease);
      req.admissionLease = lease;
      res.once('finish', release);
      res.once('close', release);
      next();
    } catch (error) {
      if (error instanceof AdmissionError && error.code === 'ADMISSION_ABORTED') {
        if (res.destroyed || res.writableEnded) return;
        endProgress(jobId, 'cancelled');
        return res.status(499).json({ error: 'Processing cancelled while waiting for capacity.' });
      }

      const code = error?.code || 'ADMISSION_FAILED';
      endProgress(jobId, 'failed', { reason: code });
      if (res.destroyed || res.writableEnded) return;

      if (code === 'JOB_EXCEEDS_CAPACITY') {
        return res.status(503).json({
          error: 'This batch exceeds the processing capacity configured for this instance.',
          code
        });
      }
      if (code === 'ADMISSION_WAIT_TIMEOUT') {
        retryAfter(res, 10);
        return res.status(503).json({ error: 'Processing capacity did not become available in time.', code });
      }
      if (code === 'ADMISSION_QUEUE_FULL' || code === 'ADMISSION_QUEUE_BYTES_FULL') {
        retryAfter(res);
        return res.status(503).json({ error: 'Processing queue is full. Please retry shortly.', code });
      }
      if (code === 'ADMISSION_SHUTDOWN') {
        retryAfter(res, 10);
        return res.status(503).json({ error: 'Server is shutting down.', code });
      }

      console.error('[Admission Error]', error);
      return res.status(500).json({ error: 'Unable to schedule processing.', code });
    }
  };
}

async function admitUploadedRequest(req, res, next) {
  const kind = kindForRequest(req);
  if (!kind || !req.jobId) return next();
  return admissionMiddleware(kind)(req, res, next);
}

function getAdmissionSnapshot() {
  return controller.snapshot();
}

function shutdownAdmission(reason = 'shutdown') {
  return controller.shutdown(reason);
}

module.exports = {
  BASE_UNITS,
  kindForRequest,
  estimateAdmission,
  preflightAdmission,
  admissionMiddleware,
  admitUploadedRequest,
  getAdmissionSnapshot,
  shutdownAdmission
};
