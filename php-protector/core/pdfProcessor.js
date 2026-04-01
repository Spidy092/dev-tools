const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Compresses a PDF file using Ghostscript.
 * inputPath: Absolute path to the source PDF.
 * outputPath: Absolute path to save the compressed PDF.
 * level: /screen (low res), /ebook (medium res), /printer (high res), /prepress
 */
function compressPDF(inputPath, outputPath, level = '/screen') {
  return new Promise((resolve, reject) => {
    // Valid levels for gs
    const validLevels = ['/screen', '/ebook', '/printer', '/prepress'];
    const gsLevel = validLevels.includes(level) ? level : '/screen';

    // Per-level settings: DPI, JPEG quality, and image filter
    const levelConfig = {
      '/screen':   { dpi: 72,  jpegQuality: 30, filter: '/DCTEncode' },
      '/ebook':    { dpi: 150, jpegQuality: 50, filter: '/DCTEncode' },
      '/printer':  { dpi: 300, jpegQuality: 95, filter: '/FlateEncode' },
      '/prepress': { dpi: 300, jpegQuality: 100, filter: '/FlateEncode' }
    };
    const cfg = levelConfig[gsLevel];

    const originalSize = fs.statSync(inputPath).size;

    const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
      -dNOPAUSE -dQUIET -dBATCH \
      -dDetectDuplicateImages=true \
      -dCompressFonts=true \
      -dSubsetFonts=true \
      -dEmbedAllFonts=true \
      -dDownsampleColorImages=true  -dColorImageResolution=${cfg.dpi} \
      -dDownsampleGrayImages=true   -dGrayImageResolution=${cfg.dpi} \
      -dDownsampleMonoImages=true   -dMonoImageResolution=${cfg.dpi} \
      -dColorImageDownsampleType=/Bicubic \
      -dGrayImageDownsampleType=/Bicubic \
      -dMonoImageDownsampleType=/Bicubic \
      -dAutoFilterColorImages=false \
      -dAutoFilterGrayImages=false \
      -dColorImageFilter=${cfg.filter} \
      -dGrayImageFilter=${cfg.filter} \
      -dJPEGQ=${cfg.jpegQuality} \
      -sOutputFile="${outputPath}" "${inputPath}"`;

    console.log(`[Ghostscript] Starting compression at level ${gsLevel} (DPI: ${cfg.dpi}, JPEG Q: ${cfg.jpegQuality})...`);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Ghostscript Error] ${stderr}`);
        return reject(stderr);
      }

      const compressedSize = fs.statSync(outputPath).size;
      const originalMB = (originalSize / 1024 / 1024).toFixed(2);
      const compressedMB = (compressedSize / 1024 / 1024).toFixed(2);
      const reduction = (((originalSize - compressedSize) / originalSize) * 100).toFixed(2);
      
      console.log(`[Ghostscript] ✅ Done: ${originalMB} MB → ${compressedMB} MB (${reduction}% reduction)`);

      resolve({
        outputPath,
        originalSize,
        compressedSize,
        originalMB,
        compressedMB,
        reduction
      });
    });
  });
}

/**
 * Returns the human-readable file size.
 */
function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return (stats.size / 1024 / 1024).toFixed(2) + " MB";
}

module.exports = { compressPDF, getFileSize };
