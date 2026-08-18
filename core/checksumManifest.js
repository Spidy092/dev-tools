const { sha256File } = require('./duplicateFinder');

const MANIFEST_FORMAT = 'devtoolkit-manifest';
const MANIFEST_VERSION = 1;
const ALGORITHM = 'sha256';
const MAX_MANIFEST_FILES = 10000;

function normalizeRelativePath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw) || raw.includes('\0')) throw new Error('Manifest contains an invalid path.');
  const segments = raw.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || /[\x00-\x1F\x7F]/.test(segment))) {
    throw new Error('Manifest contains an invalid path.');
  }
  return segments.join('/');
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Manifest contains an invalid file entry.');
  const path = normalizeRelativePath(entry.path);
  const size = Number(entry.size);
  const sha256 = String(entry.sha256 || '').toLowerCase();
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Manifest contains an invalid file size.');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Manifest contains an invalid SHA-256 digest.');
  return { path, size, sha256 };
}

function normalizeManifest(value) {
  const manifest = typeof value === 'string' ? JSON.parse(value) : value;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifest must be a JSON object.');
  if (manifest.format !== MANIFEST_FORMAT) throw new Error('Not a DevToolkit manifest.');
  if (manifest.version !== MANIFEST_VERSION) throw new Error('Unsupported manifest version.');
  if (String(manifest.algorithm || '').toLowerCase() !== ALGORITHM) throw new Error('Unsupported checksum algorithm.');
  if (!Array.isArray(manifest.files) || manifest.files.length > MAX_MANIFEST_FILES) throw new Error('Manifest file list is invalid or too large.');

  const seen = new Set();
  const files = manifest.files.map(entry => {
    const normalized = normalizeEntry(entry);
    if (seen.has(normalized.path)) throw new Error('Manifest contains duplicate file paths.');
    seen.add(normalized.path);
    return normalized;
  }).sort((a, b) => a.path.localeCompare(b.path));

  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    algorithm: ALGORITHM,
    generatedAt: typeof manifest.generatedAt === 'string' ? manifest.generatedAt : null,
    files
  };
}

function toChecksumText(manifest) {
  const normalized = normalizeManifest(manifest);
  return normalized.files.map(file => `${file.sha256}  ${file.path}`).join('\n') + (normalized.files.length ? '\n' : '');
}

async function generateManifest(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > MAX_MANIFEST_FILES) throw new Error('Too many files for one manifest.');
  const files = [];
  for (const item of list) {
    options.checkCancelled?.();
    const relativePath = normalizeRelativePath(item.relativePath);
    const size = Math.max(0, Number(item.size) || 0);
    const sha256 = await sha256File(item.filePath, options.checkCancelled);
    files.push({ path: relativePath, size, sha256 });
    options.onHashed?.({ item, sha256, size });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    algorithm: ALGORITHM,
    generatedAt: new Date().toISOString(),
    files
  };
}

async function verifyManifest(items, manifestValue, options = {}) {
  const manifest = normalizeManifest(manifestValue);
  const current = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const relativePath = normalizeRelativePath(item.relativePath);
    if (current.has(relativePath)) throw new Error('Current selection contains duplicate file paths.');
    current.set(relativePath, item);
  }

  const valid = [];
  const changed = [];
  const missing = [];
  const hashed = [];

  for (const expected of manifest.files) {
    options.checkCancelled?.();
    const item = current.get(expected.path);
    if (!item) {
      missing.push({ path: expected.path, expectedSize: expected.size, expectedSha256: expected.sha256 });
      continue;
    }
    current.delete(expected.path);
    const actualSize = Math.max(0, Number(item.size) || 0);
    if (actualSize !== expected.size) {
      changed.push({ path: expected.path, reason: 'size', expectedSize: expected.size, actualSize, expectedSha256: expected.sha256, actualSha256: null });
      continue;
    }
    const actualSha256 = await sha256File(item.filePath, options.checkCancelled);
    hashed.push(expected.path);
    options.onHashed?.({ item, sha256: actualSha256, size: actualSize });
    if (actualSha256 === expected.sha256) valid.push({ path: expected.path, size: actualSize, sha256: actualSha256 });
    else changed.push({ path: expected.path, reason: 'checksum', expectedSize: expected.size, actualSize, expectedSha256: expected.sha256, actualSha256 });
  }

  const added = Array.from(current.values()).map(item => ({
    path: normalizeRelativePath(item.relativePath),
    size: Math.max(0, Number(item.size) || 0)
  })).sort((a, b) => a.path.localeCompare(b.path));

  return {
    format: 'devtoolkit-manifest-verification',
    version: 1,
    algorithm: ALGORITHM,
    checkedAt: new Date().toISOString(),
    summary: {
      expected: manifest.files.length,
      current: (Array.isArray(items) ? items : []).length,
      hashed: hashed.length,
      valid: valid.length,
      changed: changed.length,
      missing: missing.length,
      added: added.length,
      clean: changed.length === 0 && missing.length === 0 && added.length === 0
    },
    valid,
    changed,
    missing,
    added
  };
}

module.exports = {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  ALGORITHM,
  normalizeRelativePath,
  normalizeManifest,
  toChecksumText,
  generateManifest,
  verifyManifest
};
