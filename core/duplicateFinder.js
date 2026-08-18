const {
  ProcessingError,
  validateFileItems,
  fingerprintFile,
  hashFile,
  mapLimit,
  normalizeConcurrency,
  assertActive
} = require('./processingEngine');

function normalizeMinimumSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), Number.MAX_SAFE_INTEGER);
}

function groupBySize(items, { minimumSize = 0, ignoreEmpty = true } = {}) {
  const min = normalizeMinimumSize(minimumSize);
  const groups = new Map();

  for (const item of items || []) {
    const size = Math.max(0, Number(item.size) || 0);
    if (ignoreEmpty && size === 0) continue;
    if (size < min) continue;
    if (!groups.has(size)) groups.set(size, []);
    groups.get(size).push(item);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => b[0] - a[0]);
}

async function sha256File(filePath, checkCancelled) {
  const result = await hashFile(filePath, { checkCancelled });
  return result.hash;
}

function buildReport(totalFiles, candidateFiles, hashedFiles, sampledFiles, duplicateGroups) {
  const duplicateFiles = duplicateGroups.reduce((sum, group) => sum + group.files.length, 0);
  const extraCopies = duplicateGroups.reduce((sum, group) => sum + Math.max(0, group.files.length - 1), 0);
  const recoverableBytes = duplicateGroups.reduce((sum, group) => sum + group.size * Math.max(0, group.files.length - 1), 0);

  return {
    algorithm: 'sha256',
    strategy: 'size→sample→sha256',
    totalFiles,
    candidateFiles,
    sampledFiles,
    hashedFiles,
    duplicateGroups: duplicateGroups.length,
    duplicateFiles,
    extraCopies,
    recoverableBytes,
    groups: duplicateGroups
  };
}

async function findDuplicates(items, options = {}) {
  const list = validateFileItems(Array.isArray(items) ? items : [], {
    maxItems: options.maxItems || 10000,
    maxTotalBytes: options.maxTotalBytes,
    requireUniquePaths: true
  });
  const concurrency = normalizeConcurrency(options.concurrency);
  const ioOptions = {
    concurrency,
    signal: options.signal,
    checkCancelled: options.checkCancelled,
    chunkBytes: options.chunkBytes,
    sampleBytes: options.sampleBytes
  };

  const sizeGroups = groupBySize(list, {
    minimumSize: options.minimumSize,
    ignoreEmpty: options.ignoreEmpty !== false
  });
  const candidateFiles = sizeGroups.reduce((sum, [, group]) => sum + group.length, 0);
  let sampledFiles = 0;
  let hashedFiles = 0;
  const duplicateGroups = [];

  for (const [size, group] of sizeGroups) {
    assertActive(ioOptions);

    // A small prefix+suffix fingerprint removes most same-size false candidates
    // before the expensive full-file SHA-256 pass. Fingerprints never prove
    // equality; exact duplicates still require a complete SHA-256 match.
    const sampled = await mapLimit(group, async item => {
      const result = await fingerprintFile(item.filePath, {
        ...ioOptions,
        expectedSize: item.size
      });
      sampledFiles++;
      options.onSampled?.({ item, fingerprint: result.fingerprint, size });
      return { item, fingerprint: result.fingerprint };
    }, ioOptions);

    const fingerprintGroups = new Map();
    for (const result of sampled) {
      if (!fingerprintGroups.has(result.fingerprint)) fingerprintGroups.set(result.fingerprint, []);
      fingerprintGroups.get(result.fingerprint).push(result.item);
    }

    for (const matches of fingerprintGroups.values()) {
      if (matches.length < 2) continue;
      assertActive(ioOptions);
      const hashed = await mapLimit(matches, async item => {
        const result = await hashFile(item.filePath, {
          ...ioOptions,
          expectedSize: item.size
        });
        hashedFiles++;
        options.onHashed?.({ item, hash: result.hash, size });
        return { item, hash: result.hash };
      }, ioOptions);

      const hashGroups = new Map();
      for (const result of hashed) {
        if (!hashGroups.has(result.hash)) hashGroups.set(result.hash, []);
        hashGroups.get(result.hash).push(result.item);
      }

      for (const [hash, exactMatches] of hashGroups) {
        if (exactMatches.length < 2) continue;
        const files = exactMatches.map(item => item.relativePath).sort((a, b) => a.localeCompare(b));
        duplicateGroups.push({
          hash,
          size,
          recoverableBytes: size * (files.length - 1),
          files
        });
      }
    }
  }

  duplicateGroups.sort((a, b) =>
    b.recoverableBytes - a.recoverableBytes ||
    b.size - a.size ||
    a.files[0].localeCompare(b.files[0]) ||
    a.hash.localeCompare(b.hash)
  );
  return buildReport(list.length, candidateFiles, hashedFiles, sampledFiles, duplicateGroups);
}

module.exports = {
  ProcessingError,
  normalizeMinimumSize,
  groupBySize,
  sha256File,
  buildReport,
  findDuplicates
};
