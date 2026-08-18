const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const MAX_CONCURRENCY = 8;
const MIN_CHUNK_BYTES = 64 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const DEFAULT_SAMPLE_BYTES = 64 * 1024;
const DEFAULT_MAX_ITEMS = 10000;

class ProcessingError extends Error {
  constructor(code, message, details = undefined, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProcessingError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function defaultConcurrency() {
  const available = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.min(4, Math.max(1, available || 1));
}

function normalizeConcurrency(value) {
  return clampInteger(value, defaultConcurrency(), 1, MAX_CONCURRENCY);
}

function normalizeChunkBytes(value) {
  return clampInteger(value, DEFAULT_CHUNK_BYTES, MIN_CHUNK_BYTES, MAX_CHUNK_BYTES);
}

function assertActive(options = {}) {
  options.checkCancelled?.();
  if (options.signal?.aborted) {
    const reason = options.signal.reason;
    throw new ProcessingError('PROCESSING_ABORTED', reason instanceof Error ? reason.message : 'Processing aborted');
  }
}

function validateFilePath(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
    throw new ProcessingError('INVALID_FILE_PATH', 'File path is invalid.');
  }
  return filePath;
}

function validateExpectedSize(value) {
  if (value === undefined || value === null) return undefined;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ProcessingError('INVALID_FILE_SIZE', 'Expected file size is invalid.');
  }
  return size;
}

function validateFileItems(items, options = {}) {
  if (!Array.isArray(items)) throw new ProcessingError('INVALID_ITEMS', 'File items must be an array.');
  const maxItems = clampInteger(options.maxItems, DEFAULT_MAX_ITEMS, 1, 100000);
  if (items.length > maxItems) throw new ProcessingError('TOO_MANY_FILES', `File count exceeds the ${maxItems} item core limit.`);

  const seenPaths = options.requireUniquePaths ? new Set() : null;
  let declaredBytes = 0;
  const maxTotalBytes = Number.isSafeInteger(options.maxTotalBytes) && options.maxTotalBytes >= 0 ? options.maxTotalBytes : undefined;

  const normalized = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ProcessingError('INVALID_ITEM', `File item ${index + 1} is invalid.`);
    }
    const filePath = validateFilePath(item.filePath);
    const size = validateExpectedSize(item.size);
    const relativePath = item.relativePath === undefined ? undefined : String(item.relativePath);
    if (relativePath !== undefined && (!relativePath || relativePath.includes('\0'))) {
      throw new ProcessingError('INVALID_RELATIVE_PATH', `Relative path for item ${index + 1} is invalid.`);
    }
    if (seenPaths && relativePath !== undefined) {
      if (seenPaths.has(relativePath)) throw new ProcessingError('DUPLICATE_PATH', `Duplicate relative path: ${relativePath}`);
      seenPaths.add(relativePath);
    }
    if (size !== undefined) {
      declaredBytes += size;
      if (!Number.isSafeInteger(declaredBytes)) throw new ProcessingError('SIZE_OVERFLOW', 'Declared total size exceeds the safe integer range.');
      if (maxTotalBytes !== undefined && declaredBytes > maxTotalBytes) {
        throw new ProcessingError('TOTAL_SIZE_LIMIT', 'Declared total size exceeds the core processing limit.');
      }
    }
    return { ...item, filePath, size, relativePath };
  });

  return normalized;
}

async function openRegularFile(filePath, options = {}) {
  assertActive(options);
  validateFilePath(filePath);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error && (error.code === 'ELOOP' || error.code === 'EMLINK')) {
      throw new ProcessingError('SYMLINK_REJECTED', 'Symbolic links are not accepted for processing.', undefined, error);
    }
    throw new ProcessingError('FILE_OPEN_FAILED', 'Unable to open file for processing.', { filePath }, error);
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ProcessingError('NOT_REGULAR_FILE', 'Only regular files can be processed.', { filePath });
    const expectedSize = validateExpectedSize(options.expectedSize);
    if (expectedSize !== undefined && stat.size !== expectedSize) {
      throw new ProcessingError('FILE_SIZE_MISMATCH', 'File size changed before processing.', { expectedSize, actualSize: stat.size });
    }
    if (Number.isSafeInteger(options.maxBytes) && options.maxBytes >= 0 && stat.size > options.maxBytes) {
      throw new ProcessingError('FILE_SIZE_LIMIT', 'File exceeds the core per-file processing limit.', { size: stat.size, maxBytes: options.maxBytes });
    }
    return { handle, stat };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

function stableStatFingerprint(stat) {
  return [stat.dev, stat.ino, stat.size, Math.trunc(stat.mtimeMs), Math.trunc(stat.ctimeMs)].join(':');
}

async function verifyUnchanged(handle, before, bytesRead, options = {}) {
  assertActive(options);
  const after = await handle.stat();
  if (bytesRead !== before.size || after.size !== before.size || stableStatFingerprint(after) !== stableStatFingerprint(before)) {
    throw new ProcessingError('FILE_CHANGED_DURING_READ', 'File changed while it was being processed.', {
      beforeSize: before.size,
      afterSize: after.size,
      bytesRead
    });
  }
}

async function hashFile(filePath, options = {}) {
  const algorithm = String(options.algorithm || 'sha256').toLowerCase();
  if (algorithm !== 'sha256') throw new ProcessingError('UNSUPPORTED_HASH', 'Only SHA-256 is supported by this processing engine.');
  const chunkBytes = normalizeChunkBytes(options.chunkBytes);
  const { handle, stat } = await openRegularFile(filePath, options);
  const hash = crypto.createHash(algorithm);
  const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, Math.max(1, stat.size || chunkBytes)));
  let position = 0;

  try {
    while (position < stat.size) {
      assertActive(options);
      const length = Math.min(buffer.length, stat.size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead <= 0) throw new ProcessingError('UNEXPECTED_EOF', 'File ended before the expected size was read.');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      options.onBytes?.({ bytesRead, position, total: stat.size });
    }
    await verifyUnchanged(handle, stat, position, options);
    return { hash: hash.digest('hex'), bytes: position, stat };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function readFileBuffer(filePath, options = {}) {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new ProcessingError('BUFFER_LIMIT_REQUIRED', 'Buffered reads require an explicit maximum byte limit.');
  }
  const chunkBytes = normalizeChunkBytes(options.chunkBytes);
  const { handle, stat } = await openRegularFile(filePath, options);
  const output = Buffer.allocUnsafe(stat.size);
  let position = 0;

  try {
    while (position < stat.size) {
      assertActive(options);
      const length = Math.min(chunkBytes, stat.size - position);
      const { bytesRead } = await handle.read(output, position, length, position);
      if (bytesRead <= 0) throw new ProcessingError('UNEXPECTED_EOF', 'File ended before the expected size was read.');
      position += bytesRead;
      options.onBytes?.({ bytesRead, position, total: stat.size });
    }
    await verifyUnchanged(handle, stat, position, options);
    return { buffer: output, bytes: position, stat };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function fingerprintFile(filePath, options = {}) {
  const sampleBytes = clampInteger(options.sampleBytes, DEFAULT_SAMPLE_BYTES, 4096, 1024 * 1024);
  const { handle, stat } = await openRegularFile(filePath, options);
  const hash = crypto.createHash('sha256');
  let bytesReadTotal = 0;

  try {
    assertActive(options);
    const prefixLength = Math.min(sampleBytes, stat.size);
    if (prefixLength) {
      const prefix = Buffer.allocUnsafe(prefixLength);
      const first = await handle.read(prefix, 0, prefixLength, 0);
      if (first.bytesRead !== prefixLength) throw new ProcessingError('UNEXPECTED_EOF', 'Unable to read the expected file prefix.');
      hash.update(prefix);
      bytesReadTotal += first.bytesRead;
    }

    const suffixStart = Math.max(prefixLength, stat.size - sampleBytes);
    const suffixLength = Math.max(0, stat.size - suffixStart);
    if (suffixLength) {
      assertActive(options);
      const suffix = Buffer.allocUnsafe(suffixLength);
      const last = await handle.read(suffix, 0, suffixLength, suffixStart);
      if (last.bytesRead !== suffixLength) throw new ProcessingError('UNEXPECTED_EOF', 'Unable to read the expected file suffix.');
      hash.update(suffix);
      bytesReadTotal += last.bytesRead;
    }

    hash.update(String(stat.size));
    const after = await handle.stat();
    if (stableStatFingerprint(after) !== stableStatFingerprint(stat)) {
      throw new ProcessingError('FILE_CHANGED_DURING_READ', 'File changed while it was being sampled.');
    }
    return { fingerprint: hash.digest('hex'), sampledBytes: bytesReadTotal, stat };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function statRegularFile(filePath, options = {}) {
  const { handle, stat } = await openRegularFile(filePath, options);
  await handle.close().catch(() => {});
  return stat;
}

async function mapLimit(items, worker, options = {}) {
  if (!Array.isArray(items)) throw new ProcessingError('INVALID_ITEMS', 'Items must be an array.');
  if (typeof worker !== 'function') throw new ProcessingError('INVALID_WORKER', 'Worker must be a function.');
  if (!items.length) return [];

  const concurrency = Math.min(normalizeConcurrency(options.concurrency), items.length);
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError = null;

  async function runWorker() {
    while (true) {
      if (firstError) return;
      assertActive(options);
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (!firstError) firstError = error;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  if (firstError) throw firstError;
  return results;
}

module.exports = {
  ProcessingError,
  MAX_CONCURRENCY,
  DEFAULT_CHUNK_BYTES,
  normalizeConcurrency,
  normalizeChunkBytes,
  assertActive,
  validateFileItems,
  statRegularFile,
  hashFile,
  readFileBuffer,
  fingerprintFile,
  mapLimit
};
