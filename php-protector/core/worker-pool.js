const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const fsp = require('fs').promises;
const { walkDir } = require('./utils');

const WORKER_PATH = path.join(__dirname, 'worker.js');
const MAX_WORKERS = Math.max(1, os.cpus().length - 1);

/**
 * Split array into N roughly-equal chunks
 */
function chunkArray(arr, n) {
  const chunks = Array.from({ length: n }, () => []);
  arr.forEach((item, i) => chunks[i % n].push(item));
  return chunks.filter(c => c.length > 0);
}

/**
 * Process folder using worker threads.
 * onProgress(relativePath, type) called per file.
 * Returns { phpCount, copyCount }
 */
async function processFolderParallel(inputDir, outputDir, onProgress) {
  await fsp.mkdir(outputDir, { recursive: true });
  const files = await walkDir(inputDir);

  if (files.length === 0) return { phpCount: 0, copyCount: 0 };

  const numWorkers = Math.min(MAX_WORKERS, files.length);
  const chunks = chunkArray(files, numWorkers);

  let phpCount = 0, copyCount = 0;

  const workerPromises = chunks.map(chunk => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { files: chunk, inputDir, outputDir }
    });

    worker.on('message', (msg) => {
      if (msg.event === 'file') {
        if (msg.type === 'php') phpCount++;
        else copyCount++;
        if (onProgress) onProgress(msg.relativePath, msg.type);
      } else if (msg.event === 'done') {
        resolve();
      }
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  }));

  await Promise.all(workerPromises);
  return { phpCount, copyCount };
}

module.exports = { processFolderParallel };
