const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function boundedEnvBytes(name, fallback, hardMax) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, hardMax);
}

const RESOURCE_POLICY = Object.freeze({
  codeBufferBytes: boundedEnvBytes('MAX_CODE_BUFFER_BYTES', 16 * MiB, 64 * MiB),
  textBufferBytes: boundedEnvBytes('MAX_TEXT_BUFFER_BYTES', 32 * MiB, 128 * MiB),
  imageBufferBytes: boundedEnvBytes('MAX_IMAGE_BUFFER_BYTES', 64 * MiB, 256 * MiB),
  archiveBufferBytes: boundedEnvBytes('MAX_ARCHIVE_BUFFER_BYTES', 64 * MiB, 256 * MiB),
  coreBatchBytes: boundedEnvBytes('MAX_CORE_BATCH_BYTES', 1024 * MiB, 4 * GiB),
  maxFiles: 10000
});

function totalDeclaredBytes(files, limit = RESOURCE_POLICY.coreBatchBytes) {
  if (!Array.isArray(files)) throw new TypeError('files must be an array');
  let total = 0;
  for (const file of files) {
    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid declared file size.');
    total += size;
    if (!Number.isSafeInteger(total)) throw new RangeError('Declared total exceeds the safe integer range.');
    if (Number.isSafeInteger(limit) && limit >= 0 && total > limit) {
      const error = new RangeError('Declared batch exceeds the core resource budget.');
      error.code = 'CORE_BATCH_LIMIT';
      error.limit = limit;
      error.total = total;
      throw error;
    }
  }
  return total;
}

module.exports = {
  MiB,
  GiB,
  RESOURCE_POLICY,
  totalDeclaredBytes
};
