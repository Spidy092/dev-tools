const { parentPort, workerData } = require('worker_threads');
const fs = require('fs').promises;
const path = require('path');
const { obfuscateCode } = require('./obfuscator');

(async () => {
  const { files, outputDir } = workerData;

  for (const { fullPath, relativePath } of files) {
    const outPath = path.join(outputDir, relativePath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });

    if (path.extname(fullPath).toLowerCase() === '.php') {
      const content = await fs.readFile(fullPath, 'utf8');
      await fs.writeFile(outPath, obfuscateCode(content), 'utf8');
      parentPort.postMessage({ event: 'file', relativePath, type: 'php' });
    } else {
      await fs.copyFile(fullPath, outPath);
      parentPort.postMessage({ event: 'file', relativePath, type: 'copy' });
    }
  }

  parentPort.postMessage({ event: 'done' });
})();
