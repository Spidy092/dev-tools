const fsp = require('fs').promises;
const path = require('path');

/**
 * Async recursive walk — returns flat list of {fullPath, relativePath}
 */
async function walkDir(dir, baseDir = dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push({ fullPath, relativePath: path.relative(baseDir, fullPath) });
    }
  }
  return results;
}

module.exports = { walkDir };
