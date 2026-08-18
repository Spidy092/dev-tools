const fsp = require('fs').promises;
const path = require('path');
const { walkDir } = require('./utils');

/**
 * Takes PHP source code string, returns obfuscated PHP string.
 */
function obfuscateCode(code) {
  const payload = "?>" + code;
  const encoded = Buffer.from(payload).toString('base64');
  return `<?php eval(base64_decode('${encoded}'));`;
}

/**
 * Async version of processFolder.
 * Calls onFile(relativePath, type) for progress reporting.
 */
async function processFolder(inputDir, outputDir, onFile) {
  await fsp.mkdir(outputDir, { recursive: true });
  const files = await walkDir(inputDir);

  for (const { fullPath, relativePath } of files) {
    const outPath = path.join(outputDir, relativePath);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });

    if (path.extname(fullPath).toLowerCase() === '.php') {
      const content = await fsp.readFile(fullPath, 'utf8');
      await fsp.writeFile(outPath, obfuscateCode(content), 'utf8');
      if (onFile) onFile(relativePath, 'php');
    } else {
      await fsp.copyFile(fullPath, outPath);
      if (onFile) onFile(relativePath, 'copy');
    }
  }
}

module.exports = { obfuscateCode, processFolder };
