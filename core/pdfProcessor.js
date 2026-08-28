const { spawn } = require('child_process');
const fs = require('fs');
const { statRegularFile, assertActive, ProcessingError } = require('./processingEngine');

class PdfProcessingError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PdfProcessingError';
    this.code = code;
  }
}

function processTimeoutMs() {
  const configured = Number(process.env.PDF_PROCESS_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return 120000;
  return Math.min(10 * 60 * 1000, Math.max(1000, Math.floor(configured)));
}

/**
 * Compresses a PDF file using Ghostscript without invoking a shell.
 * The input must be a regular file, cancellation kills Ghostscript promptly,
 * stderr is bounded, and the output is verified before it is returned.
 */
async function compressPDF(inputPath, outputPath, level = '/screen', options = {}) {
  const validLevels = ['/screen', '/ebook', '/printer', '/prepress'];
  const gsLevel = validLevels.includes(level) ? level : '/screen';
  const levelConfig = {
    '/screen':   { dpi: 72,  jpegQuality: 30, filter: '/DCTEncode' },
    '/ebook':    { dpi: 150, jpegQuality: 50, filter: '/DCTEncode' },
    '/printer':  { dpi: 300, jpegQuality: 95, filter: '/FlateEncode' },
    '/prepress': { dpi: 300, jpegQuality: 100, filter: '/FlateEncode' }
  };
  const cfg = levelConfig[gsLevel];

  assertActive(options);
  const inputStat = await statRegularFile(inputPath, {
    expectedSize: options.expectedSize,
    maxBytes: options.maxBytes,
    signal: options.signal,
    checkCancelled: options.checkCancelled
  });
  const originalSize = inputStat.size;

  await fs.promises.rm(outputPath, { force: true }).catch(() => {});
  assertActive(options);

  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true', '-dSubsetFonts=true', '-dEmbedAllFonts=true',
    '-dDownsampleColorImages=true', `-dColorImageResolution=${cfg.dpi}`,
    '-dDownsampleGrayImages=true', `-dGrayImageResolution=${cfg.dpi}`,
    '-dDownsampleMonoImages=true', `-dMonoImageResolution=${cfg.dpi}`,
    '-dColorImageDownsampleType=/Bicubic',
    '-dGrayImageDownsampleType=/Bicubic',
    '-dMonoImageDownsampleType=/Bicubic',
    '-dAutoFilterColorImages=false',
    '-dAutoFilterGrayImages=false',
    `-dColorImageFilter=${cfg.filter}`,
    `-dGrayImageFilter=${cfg.filter}`,
    `-dJPEGQ=${cfg.jpegQuality}`,
    `-sOutputFile=${outputPath}`,
    inputPath
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let stderr = '';
    let timeout;
    let abortListener;
    let child;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (options.signal && abortListener) options.signal.removeEventListener('abort', abortListener);
    };

    const rejectOnce = async error => {
      if (settled) return;
      settled = true;
      cleanup();
      await fs.promises.rm(outputPath, { force: true }).catch(() => {});
      reject(error);
    };

    const resolveOnce = value => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    try {
      child = spawn('gs', args, {
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe']
      });
    } catch (error) {
      void rejectOnce(new PdfProcessingError('PDF_SPAWN_FAILED', 'Unable to start Ghostscript.', error));
      return;
    }

    const terminate = reason => {
      if (!child || child.killed) return;
      try { child.kill('SIGKILL'); } catch (_) {}
      if (reason === 'timeout') timedOut = true;
      else aborted = true;
    };

    timeout = setTimeout(() => terminate('timeout'), processTimeoutMs());
    timeout.unref?.();

    if (options.signal) {
      abortListener = () => terminate('abort');
      if (options.signal.aborted) abortListener();
      else options.signal.addEventListener('abort', abortListener, { once: true });
    }

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 16_384) stderr = stderr.slice(-16_384);
    });

    child.on('error', error => {
      void rejectOnce(new PdfProcessingError('PDF_SPAWN_FAILED', `Unable to start Ghostscript: ${error.message}`, error));
    });

    child.on('close', async code => {
      if (settled) return;
      cleanup();

      if (aborted) {
        await rejectOnce(new ProcessingError('PROCESSING_ABORTED', 'PDF processing aborted.'));
        return;
      }
      if (timedOut) {
        await rejectOnce(new PdfProcessingError('PDF_TIMEOUT', 'Ghostscript processing timed out.'));
        return;
      }
      if (code !== 0) {
        const suffix = stderr ? `: ${stderr.slice(-1000)}` : '';
        await rejectOnce(new PdfProcessingError('PDF_GHOSTSCRIPT_FAILED', `Ghostscript compression failed${suffix}`));
        return;
      }

      try {
        assertActive(options);
        const outputStat = await statRegularFile(outputPath, {
          signal: options.signal,
          checkCancelled: options.checkCancelled
        });
        const compressedSize = outputStat.size;
        const reduction = originalSize > 0
          ? +(((originalSize - compressedSize) / originalSize) * 100).toFixed(2)
          : 0;
        resolveOnce({
          outputPath,
          originalSize,
          compressedSize,
          originalMB: (originalSize / 1024 / 1024).toFixed(2),
          compressedMB: (compressedSize / 1024 / 1024).toFixed(2),
          reduction
        });
      } catch (error) {
        await rejectOnce(error);
      }
    });
  });
}

function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return (stats.size / 1024 / 1024).toFixed(2) + ' MB';
}

module.exports = {
  PdfProcessingError,
  compressPDF,
  getFileSize
};
