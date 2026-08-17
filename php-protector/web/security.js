const path = require('path');

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
 */
function validateUploadedFiles(req, res, next) {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    // Validate every client-provided relative path before a route can use it.
    req.safePaths = normalizePaths(req.body.paths, files);
    next();
  } catch (_error) {
    return res.status(400).json({ error: 'One or more uploaded file paths are invalid.' });
  }
}

module.exports = { safeRelativePath, normalizePaths, validateUploadedFiles };
