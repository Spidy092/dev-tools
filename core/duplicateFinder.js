const crypto = require('crypto');
const fs = require('fs');

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
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });

  try {
    for await (const chunk of stream) {
      checkCancelled?.();
      hash.update(chunk);
    }
    checkCancelled?.();
    return hash.digest('hex');
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function buildReport(totalFiles, candidateFiles, duplicateGroups) {
  const duplicateFiles = duplicateGroups.reduce((sum, group) => sum + group.files.length, 0);
  const extraCopies = duplicateGroups.reduce((sum, group) => sum + Math.max(0, group.files.length - 1), 0);
  const recoverableBytes = duplicateGroups.reduce((sum, group) => sum + group.size * Math.max(0, group.files.length - 1), 0);

  return {
    algorithm: 'sha256',
    totalFiles,
    candidateFiles,
    hashedFiles: candidateFiles,
    duplicateGroups: duplicateGroups.length,
    duplicateFiles,
    extraCopies,
    recoverableBytes,
    groups: duplicateGroups
  };
}

async function findDuplicates(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const checkCancelled = options.checkCancelled;
  const sizeGroups = groupBySize(list, {
    minimumSize: options.minimumSize,
    ignoreEmpty: options.ignoreEmpty !== false
  });
  const candidateFiles = sizeGroups.reduce((sum, [, group]) => sum + group.length, 0);
  const duplicateGroups = [];

  for (const [size, group] of sizeGroups) {
    checkCancelled?.();
    const hashes = new Map();

    for (const item of group) {
      checkCancelled?.();
      const hash = await sha256File(item.filePath, checkCancelled);
      if (!hashes.has(hash)) hashes.set(hash, []);
      hashes.get(hash).push(item);
      options.onHashed?.({ item, hash, size });
    }

    for (const [hash, matches] of hashes) {
      if (matches.length < 2) continue;
      duplicateGroups.push({
        hash,
        size,
        recoverableBytes: size * (matches.length - 1),
        files: matches.map(item => item.relativePath)
      });
    }
  }

  duplicateGroups.sort((a, b) => b.recoverableBytes - a.recoverableBytes || b.size - a.size || a.hash.localeCompare(b.hash));
  return buildReport(list.length, candidateFiles, duplicateGroups);
}

module.exports = {
  normalizeMinimumSize,
  groupBySize,
  sha256File,
  buildReport,
  findDuplicates
};
