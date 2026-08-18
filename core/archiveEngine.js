const archiver = require('archiver');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const { ProcessingError, assertActive, createVerifiedReadStream } = require('./processingEngine');

const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_COMPRESSION_LEVEL = 6;
const ZIP_SAFE_EPOCH = new Date('1980-01-01T00:00:00.000Z');
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function normalizeArchivePath(value, options = {}) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw) || raw.includes('\0')) {
    throw new ProcessingError('INVALID_ARCHIVE_PATH', 'Archive entry path is invalid.');
  }
  const segments = raw.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || /[\x00-\x1F\x7F]/.test(segment))) {
    throw new ProcessingError('INVALID_ARCHIVE_PATH', 'Archive entry path is invalid.');
  }

  const portable = options.portable !== false;
  if (portable) {
    for (const segment of segments) {
      if (/[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment)) {
        throw new ProcessingError('NON_PORTABLE_ARCHIVE_PATH', `Archive entry is not portable across operating systems: ${segment}`);
      }
      if (Buffer.byteLength(segment, 'utf8') > 255) {
        throw new ProcessingError('ARCHIVE_PATH_TOO_LONG', 'Archive entry contains a path segment longer than 255 UTF-8 bytes.');
      }
    }
  }

  const normalized = segments.join('/');
  if (Buffer.byteLength(normalized, 'utf8') > 4096) {
    throw new ProcessingError('ARCHIVE_PATH_TOO_LONG', 'Archive entry path exceeds 4096 UTF-8 bytes.');
  }
  return normalized;
}

function normalizeCompressionLevel(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_COMPRESSION_LEVEL;
  return Math.min(9, Math.max(0, Math.floor(parsed)));
}

function validateEntries(entries, options = {}) {
  if (!Array.isArray(entries)) throw new ProcessingError('INVALID_ARCHIVE_ENTRIES', 'Archive entries must be an array.');
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
    ? Math.min(options.maxEntries, 100000)
    : DEFAULT_MAX_ENTRIES;
  if (entries.length > maxEntries) throw new ProcessingError('TOO_MANY_ARCHIVE_ENTRIES', `Archive exceeds the ${maxEntries} entry limit.`);

  const seen = new Set();
  const portableSeen = new Set();
  let declaredBytes = 0;
  const maxTotalBytes = Number.isSafeInteger(options.maxTotalBytes) && options.maxTotalBytes >= 0 ? options.maxTotalBytes : undefined;

  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ProcessingError('INVALID_ARCHIVE_ENTRY', `Archive entry ${index + 1} is invalid.`);
    }
    const name = normalizeArchivePath(entry.name, options);
    if (seen.has(name)) throw new ProcessingError('DUPLICATE_ARCHIVE_PATH', `Duplicate archive entry path: ${name}`);
    seen.add(name);

    if (options.portable !== false) {
      const folded = name.toLocaleLowerCase('en-US');
      if (portableSeen.has(folded)) {
        throw new ProcessingError('PORTABLE_ARCHIVE_COLLISION', `Archive paths collide on a case-insensitive filesystem: ${name}`);
      }
      portableSeen.add(folded);
    }

    const size = entry.size === undefined ? undefined : Number(entry.size);
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0)) {
      throw new ProcessingError('INVALID_ARCHIVE_SIZE', `Archive entry ${name} has an invalid size.`);
    }
    if (size !== undefined) {
      declaredBytes += size;
      if (!Number.isSafeInteger(declaredBytes)) throw new ProcessingError('SIZE_OVERFLOW', 'Archive declared size exceeds the safe integer range.');
      if (maxTotalBytes !== undefined && declaredBytes > maxTotalBytes) {
        throw new ProcessingError('ARCHIVE_SIZE_LIMIT', 'Archive declared size exceeds the configured limit.');
      }
    }

    const sourceCount = Number(Boolean(entry.filePath)) + Number(Buffer.isBuffer(entry.buffer)) + Number(typeof entry.open === 'function');
    if (sourceCount !== 1) {
      throw new ProcessingError('INVALID_ARCHIVE_SOURCE', `Archive entry ${name} must define exactly one source.`);
    }
    return { ...entry, name, size };
  });
}

function lazySource(entry, options = {}) {
  async function* generate() {
    assertActive(options);
    let source;
    let outputBytes = 0;

    if (entry.filePath) {
      source = createVerifiedReadStream(entry.filePath, {
        expectedSize: entry.size,
        maxBytes: options.maxFileBytes,
        chunkBytes: options.chunkBytes,
        signal: options.signal,
        checkCancelled: options.checkCancelled,
        onBytes: payload => options.onBytes?.({ entry, ...payload })
      });
    } else if (Buffer.isBuffer(entry.buffer)) {
      if (Number.isSafeInteger(options.maxBufferBytes) && entry.buffer.length > options.maxBufferBytes) {
        throw new ProcessingError('ARCHIVE_BUFFER_LIMIT', `Archive entry ${entry.name} exceeds the in-memory buffer limit.`);
      }
      source = entry.buffer;
    } else {
      source = await entry.open();
    }

    if (Buffer.isBuffer(source) || typeof source === 'string') {
      const chunk = Buffer.isBuffer(source) ? source : Buffer.from(source);
      outputBytes += chunk.length;
      yield chunk;
      assertActive(options);
      options.onEntryComplete?.({ entry, outputBytes });
      return;
    }
    if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
      throw new ProcessingError('INVALID_ARCHIVE_SOURCE', `Archive entry ${entry.name} did not produce a readable source.`);
    }
    for await (const chunk of source) {
      assertActive(options);
      outputBytes += Buffer.byteLength(chunk);
      yield chunk;
    }
    assertActive(options);
    options.onEntryComplete?.({ entry, outputBytes });
  }
  return Readable.from(generate(), { objectMode: false });
}

async function writeZip(destination, entries, options = {}) {
  if (!destination || typeof destination.write !== 'function' || typeof destination.on !== 'function') {
    throw new ProcessingError('INVALID_ARCHIVE_DESTINATION', 'Archive destination must be a writable stream.');
  }
  assertActive(options);
  const validated = validateEntries(entries, options);
  const archive = archiver('zip', { zlib: { level: normalizeCompressionLevel(options.level) } });
  let settled = false;
  let abortListener;

  const fail = error => {
    if (settled) return;
    try { archive.abort(); } catch (_) {}
    if (typeof destination.destroy === 'function' && !destination.destroyed) destination.destroy(error);
  };

  archive.on('warning', warning => {
    if (warning && warning.code === 'ENOENT') fail(new ProcessingError('ARCHIVE_SOURCE_MISSING', 'An archive source disappeared during processing.', undefined, warning));
    else fail(warning);
  });
  archive.on('error', fail);
  destination.on('error', fail);

  if (options.signal) {
    abortListener = () => fail(new ProcessingError('PROCESSING_ABORTED', 'Archive processing aborted.'));
    if (options.signal.aborted) abortListener();
    else options.signal.addEventListener('abort', abortListener, { once: true });
  }

  archive.pipe(destination);

  try {
    for (const entry of validated) {
      assertActive(options);
      archive.append(lazySource(entry, options), { name: entry.name, date: options.entryDate || ZIP_SAFE_EPOCH });
      options.onEntryQueued?.(entry);
    }
    await archive.finalize();
    await finished(destination);
    assertActive(options);
    settled = true;
    return {
      entries: validated.length,
      outputBytes: typeof archive.pointer === 'function' ? archive.pointer() : null
    };
  } catch (error) {
    fail(error);
    throw error;
  } finally {
    settled = true;
    if (options.signal && abortListener) options.signal.removeEventListener('abort', abortListener);
    archive.removeAllListeners();
    destination.removeListener('error', fail);
  }
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  ZIP_SAFE_EPOCH,
  normalizeArchivePath,
  validateEntries,
  writeZip
};
