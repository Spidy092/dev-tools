const fsp = require('fs').promises;
const path = require('path');

class WalkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WalkError';
    this.code = code;
  }
}

/**
 * Iterative, deterministic directory walk.
 * - never follows symbolic links
 * - ignores sockets/devices/FIFOs
 * - bounds file count, directory count and depth
 * - returns a flat list of regular files only
 */
async function walkDir(dir, baseDir = dir, options = {}) {
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 10000;
  const maxDirectories = Number.isSafeInteger(options.maxDirectories) && options.maxDirectories > 0 ? options.maxDirectories : 10000;
  const maxDepth = Number.isSafeInteger(options.maxDepth) && options.maxDepth >= 0 ? options.maxDepth : 128;

  const root = path.resolve(dir);
  const base = path.resolve(baseDir);
  const rootStat = await fsp.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new WalkError('INVALID_WALK_ROOT', 'Directory walk root must be a real directory, not a symbolic link.');
  }

  const stack = [{ dir: root, depth: 0 }];
  const results = [];
  let directories = 0;

  while (stack.length) {
    const current = stack.pop();
    directories++;
    if (directories > maxDirectories) throw new WalkError('TOO_MANY_DIRECTORIES', `Directory walk exceeds the ${maxDirectories} directory limit.`);
    if (current.depth > maxDepth) throw new WalkError('MAX_WALK_DEPTH', `Directory walk exceeds the ${maxDepth} level depth limit.`);

    const entries = await fsp.readdir(current.dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const childDirs = [];
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        childDirs.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = path.relative(base, fullPath);
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new WalkError('WALK_PATH_ESCAPE', 'Directory walk produced a path outside the requested base directory.');
      }
      results.push({ fullPath, relativePath });
      if (results.length > maxFiles) throw new WalkError('TOO_MANY_FILES', `Directory walk exceeds the ${maxFiles} file limit.`);
    }

    for (let i = childDirs.length - 1; i >= 0; i--) stack.push(childDirs[i]);
  }

  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

module.exports = { WalkError, walkDir };
