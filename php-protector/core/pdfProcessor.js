const { spawn } = require('child_process');
const fs = require('fs');

/**
 * Compresses a PDF file using Ghostscript without invoking a shell.
 * This prevents uploaded filenames/paths from being interpreted as shell syntax.
 */
function compressPDF(inputPath, outputPath, level = '/screen') {
  return new Promise((resolve, reject) => {
    const validLevels = ['/screen', '/ebook', '/printer', '/prepress'];
    const gsLevel = validLevels.includes(level) ? level : '/screen';

    const levelConfig = {
      '/screen':   { dpi: 72,  jpegQuality: 30, filter: '/DCTEncode' },
      '/ebook':    { dpi: 150, jpegQuality: 50, filter: '/DCTEncode' },
      '/printer':  { dpi: 300, jpegQuality: 95, filter: '/FlateEncode' },
      '/prepress': { dpi: 300, jpegQuality: 100, filter: '/FlateEncode' }
    };
    const cfg = levelConfig[gsLevel];
    const originalSize = fs.statSync(inputPath).size;

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

    console.log(`[Ghostscript] Starting compression at ${gsLevel} (${cfg.dpi} DPI)...`);

    const child = spawn('gs', args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, Number(process.env.PDF_PROCESS_TIMEOUT_MS) || 120000);

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 16_384) stderr = stderr.slice(-16_384);
    });

    child.on('error', error => {
      clearTimeout(timeout);
      reject(new Error(`Unable to start Ghostscript: ${error.message}`));
    });

    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.error('[Ghostscript Error]', stderr);
        return reject(new Error('Ghostscript compression failed'));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error('Ghostscript did not produce an output file'));
      }

      const compressedSize = fs.statSync(outputPath).size;
      const originalMB = (originalSize / 1024 / 1024).toFixed(2);
      const compressedMB = (compressedSize / 1024 / 1024).toFixed(2);
      const reduction = originalSize > 0
        ? (((originalSize - compressedSize) / originalSize) * 100).toFixed(2)
        : '0.00';

      resolve({ outputPath, originalSize, compressedSize, originalMB, compressedMB, reduction });
    });
  });
}

function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return (stats.size / 1024 / 1024).toFixed(2) + ' MB';
}

module.exports = { compressPDF, getFileSize };
