const sharp = require('sharp');
const path = require('path');

/**
 * Image Compressor — supports all major image formats via Sharp.
 *
 * Strategy:
 *  - Re-encode lossy formats (jpeg, webp, avif, heif, tiff) at the requested quality.
 *  - For PNG: use palette quantization + max compression to shrink without changing the visual.
 *  - For GIF: re-encode (Sharp can decode GIF frames, we take the first page).
 *  - For SVG: passthrough (Sharp can't encode SVG; we just copy).
 *  - Optionally strip EXIF / metadata to reduce size further.
 *  - Optionally downscale to a max width while preserving aspect ratio.
 */

// All extensions we accept as input
const SUPPORTED_INPUTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif',
  '.tiff', '.tif', '.gif', '.heif', '.heic',
  '.svg', '.bmp', '.jp2', '.jxl'
]);

// All extensions that can be re-encoded to produce a smaller file.
// (SVG is excluded: Sharp can read it but not write it back, so we passthrough.)
const REENCODABLE = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif',
  '.tiff', '.tif', '.gif', '.heif', '.heic'
]);

/**
 * Quality presets (1-100). Each preset maps to internal encoder options
 * per format. The "level" parameter is a string: 'low' | 'medium' | 'high' | 'lossless' | 'custom'.
 * For 'custom', `customQuality` (1-100) must be provided.
 */
const PRESETS = {
  low:    { jpeg: 50, webp: 50, avif: 40, heif: 40, tiff: 50, pngPalette: true,  pngCompression: 9 },
  medium: { jpeg: 70, webp: 70, avif: 55, heif: 55, tiff: 70, pngPalette: true,  pngCompression: 9 },
  high:   { jpeg: 85, webp: 85, avif: 70, heif: 70, tiff: 85, pngPalette: false, pngCompression: 9 },
  lossless: { jpeg: 100, webp: 100, avif: 90, heif: 90, tiff: 100, pngPalette: false, pngCompression: 9 }
};

function getPreset(level, customQuality) {
  if (level === 'custom') {
    const q = Math.min(100, Math.max(1, parseInt(customQuality) || 80));
    return {
      jpeg: q, webp: q, avif: Math.max(30, Math.round(q * 0.8)),
      heif: Math.max(30, Math.round(q * 0.8)), tiff: q,
      pngPalette: q < 90, pngCompression: 9
    };
  }
  return PRESETS[level] || PRESETS.medium;
}

/**
 * Compress a single image buffer.
 *
 * options:
 *   level           'low' | 'medium' | 'high' | 'lossless' | 'custom' (default: 'medium')
 *   customQuality   1-100, used when level='custom'
 *   maxWidth        optional cap on width (px). null/0 = no resize
 *   stripMetadata   bool, default true
 *   targetFormat    optional override of output format (e.g. 'webp'). If not given, keeps source format.
 *
 * Returns: { buffer, format, originalSize, compressedSize, reduction, skipped, reason }
 */
async function compressImage(buffer, options = {}) {
  const level = options.level || 'medium';
  const preset = getPreset(level, options.customQuality);
  const stripMetadata = options.stripMetadata !== false; // default true
  const maxWidth = parseInt(options.maxWidth) || 0;
  const targetFormat = (options.targetFormat || '').toLowerCase().trim();
  const originalSize = buffer.length;

  // Detect source format from the buffer itself
  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'none' }).metadata();
  } catch (e) {
    throw new Error(`Could not read image metadata: ${e.message}`);
  }

  // SVG: Sharp cannot encode SVG output, so we passthrough.
  if (meta.format === 'svg') {
    return {
      buffer,
      format: 'svg',
      originalSize,
      compressedSize: originalSize,
      reduction: 0,
      skipped: true,
      reason: 'SVG passed through unchanged (vector format).'
    };
  }

  // Build the pipeline
  let pipeline = sharp(buffer, { failOn: 'none', pages: 1, limitInputPixels: false });

  // Sharp's default behavior already strips all metadata. Only call withMetadata()
  // when the user explicitly wants to KEEP it.
  if (!stripMetadata) pipeline = pipeline.withMetadata();

  if (maxWidth > 0 && meta.width && meta.width > maxWidth) {
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }

  // Determine output format. Default: keep source format.
  // Note: Sharp doesn't support all decoders as encoders. We fall back gracefully.
  const sourceFormat = (meta.format || '').toLowerCase();
  const outFormat = (targetFormat || sourceFormat).toLowerCase();

  let outputBuffer;
  try {
    switch (outFormat) {
      case 'jpeg':
      case 'jpg':
        outputBuffer = await pipeline
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: preset.jpeg, mozjpeg: true, progressive: true, optimizeScans: true })
          .toBuffer();
        break;

      case 'webp':
        outputBuffer = await pipeline
          .webp({ quality: preset.webp, effort: 6 })
          .toBuffer();
        break;

      case 'avif':
        outputBuffer = await pipeline
          .avif({ quality: preset.avif, effort: 6 })
          .toBuffer();
        break;

      case 'heif':
      case 'heic':
        // Try HEVC first; if unsupported in this libvips build, try AV1.
        try {
          outputBuffer = await pipeline
            .heif({ quality: preset.heif, compression: 'hevc', effort: 6 })
            .toBuffer();
        } catch (_hevcErr) {
          outputBuffer = await pipeline
            .heif({ quality: preset.heif, compression: 'av1', effort: 6 })
            .toBuffer();
        }
        break;

      case 'tiff':
      case 'tif':
        outputBuffer = await pipeline
          .tiff({ quality: preset.tiff, compression: 'lzw' })
          .toBuffer();
        break;

      case 'png':
        if (preset.pngPalette) {
          outputBuffer = await pipeline
            .png({ compressionLevel: preset.pngCompression, palette: true, effort: 10, colours: 256 })
            .toBuffer();
        } else {
          outputBuffer = await pipeline
            .png({ compressionLevel: preset.pngCompression, effort: 10 })
            .toBuffer();
        }
        break;

      case 'gif':
        outputBuffer = await pipeline
          .gif({ effort: 10 })
          .toBuffer();
        break;

      case 'jp2':
        outputBuffer = await pipeline
          .jp2({ quality: preset.jpeg })
          .toBuffer();
        break;

      case 'jxl':
        outputBuffer = await pipeline
          .jxl({ distance: Math.max(0.1, (100 - preset.jpeg) / 20) })
          .toBuffer();
        break;

      case 'bmp':
        // Sharp has no BMP encoder. BMP is uncompressed anyway, so we just
        // copy the input through (or fall back to PNG for any size benefit).
        outputBuffer = buffer;
        break;

      default:
        // Fall back to JPEG (universally supported)
        outputBuffer = await pipeline
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: preset.jpeg, mozjpeg: true, progressive: true })
          .toBuffer();
        break;
    }
  } catch (e) {
    // If the chosen format fails (e.g. AVIF not supported in this Sharp build),
    // fall back to WebP which is always available.
    try {
      outputBuffer = await sharp(buffer, { failOn: 'none' })
        .webp({ quality: preset.webp })
        .toBuffer();
    } catch (e2) {
      throw new Error(`Could not encode image as ${outFormat}: ${e.message}`);
    }
  }

  const compressedSize = outputBuffer.length;
  const reduction = originalSize > 0
    ? +(((originalSize - compressedSize) / originalSize) * 100).toFixed(2)
    : 0;

  return {
    buffer: outputBuffer,
    format: outFormat,
    originalSize,
    compressedSize,
    reduction,
    skipped: false,
    reason: null
  };
}

/**
 * Build the output filename. If the user picked a target format, swap the extension.
 * Otherwise keep the original extension (we re-encode in place).
 */
function buildOutputName(originalName, targetFormat) {
  if (!targetFormat) return originalName;
  const parsed = path.parse(originalName);
  const newExt = targetFormat === 'jpg' ? 'jpg' : targetFormat;
  return parsed.name + '.' + newExt;
}

module.exports = {
  compressImage,
  buildOutputName,
  SUPPORTED_INPUTS,
  REENCODABLE,
  PRESETS
};
