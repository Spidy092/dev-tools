const path = require('path');
const { cleanupJob } = require('./multer-setup');
const { admitUploadedRequest } = require('./admission');

/**
 * Normalize a user-provided relative path for archive/file output use.
 * Rejects traversal, absolute paths, drive-letter paths, control characters,
 * null bytes, and empty names.
 */
function safeRelativePath(value, fallback = 'file') {
  const raw = String(value || fallback).replace(/\\/g, '/');

  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/') || raw.includes('\0')) {
    throw new Error('Invalid file path');
  }

  const segments = raw
    .split('/')
    .filter(Boolean)
    .map(segment => segment.replace(/[\x00-\x1F\x7F]/g, '').trim());

  if (!segments.length || segments.some(segment => segment === '..' || segment === '.')) {
    throw new Error('Invalid file path');
  }

  const normalized = path.posix.normalize(segments.join('/'));
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
    throw new Error('Invalid file path');
  }

  return normalized;
}

function normalizePaths(paths, files = []) {
  const values = Array.isArray(paths) ? paths : [paths];
  return files.map((file, index) => safeRelativePath(values[index] || file.originalname, file.originalname));
}

/**
 * Apply after Multer has parsed an upload. The reverse proxy should also
 * enforce request-body limits in production so oversized payloads are rejected
 * before being written to temporary storage.
 *
 * This is also the shared post-upload admission boundary. No processor is
 * entered until paths are safe and the global scheduler grants a lease.
 */
async function validateUploadedFiles(req, res, next) {
  try {
    const files = req.files || [];
    if (!files.length) {
      cleanupJob(req.jobId);
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Validate every client-provided relative path before admission so queued
    // jobs can never reserve capacity using unsafe output paths.
    req.safePaths = normalizePaths(req.body.paths, files);
  } catch (_error) {
    // Multer has already written the upload by this stage. Invalid client paths
    // must not leave rejected files behind until the periodic stale-file sweep.
    cleanupJob(req.jobId);
    return res.status(400).json({ error: 'One or more uploaded file paths are invalid.' });
  }

  return admitUploadedRequest(req, res, next);
}

module.exports = { safeRelativePath, normalizePaths, validateUploadedFiles };
