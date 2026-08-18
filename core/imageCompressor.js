const sharp = require('sharp');
const path = require('path');

const SUPPORTED_INPUTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif',
  '.tiff', '.tif', '.gif', '.heif', '.heic',
  '.svg', '.bmp', '.jp2', '.jxl'
]);

const REENCODABLE = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif',
  '.tiff', '.tif', '.gif', '.heif', '.heic'
]);

const PRESETS = {
  low:      { jpeg: 50,  webp: 50,  avif: 40, heif: 40, tiff: 50,  pngPalette: true,  pngCompression: 9 },
  medium:   { jpeg: 70,  webp: 70,  avif: 55, heif: 55, tiff: 70,  pngPalette: true,  pngCompression: 9 },
  high:     { jpeg: 85,  webp: 85,  avif: 70, heif: 70, tiff: 85,  pngPalette: false, pngCompression: 9 },
  lossless: { jpeg: 100, webp: 100, avif: 90, heif: 90, tiff: 100, pngPalette: false, pngCompression: 9 }
};

const MAX_INPUT_PIXELS = Number(process.env.MAX_IMAGE_PIXELS) || 100_000_000;
const MAX_OUTPUT_WIDTH = Number(process.env.MAX_IMAGE_OUTPUT_WIDTH) || 16_384;

function getPreset(level, customQuality) {
  if (level === 'custom') {
    const q = Math.min(100, Math.max(1, parseInt(customQuality, 10) || 80));
    return {
      jpeg: q,
      webp: q,
      avif: Math.max(30, Math.round(q * 0.8)),
      heif: Math.max(30, Math.round(q * 0.8)),
      tiff: q,
      pngPalette: q < 90,
      pngCompression: 9
    };
  }
  return PRESETS[level] || PRESETS.medium;
}

function makeSharp(buffer, extra = {}) {
  return sharp(buffer, {
    failOn: 'none',
    limitInputPixels: MAX_INPUT_PIXELS,
    ...extra
  });
}

async function compressImage(buffer, options = {}) {
  const level = options.level || 'medium';
  const preset = getPreset(level, options.customQuality);
  const stripMetadata = options.stripMetadata !== false;
  const requestedMaxWidth = parseInt(options.maxWidth, 10) || 0;
  const maxWidth = requestedMaxWidth > 0 ? Math.min(requestedMaxWidth, MAX_OUTPUT_WIDTH) : 0;
  const targetFormat = (options.targetFormat || '').toLowerCase().trim();
  const originalSize = buffer.length;

  let meta;
  try {
    meta = await makeSharp(buffer).metadata();
  } catch (e) {
    throw new Error(`Could not read image metadata: ${e.message}`);
  }

  if (meta.width && meta.height && meta.width * meta.height > MAX_INPUT_PIXELS) {
    throw new Error(`Image exceeds the ${MAX_INPUT_PIXELS.toLocaleString()} pixel safety limit.`);
  }

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

  let pipeline = makeSharp(buffer, { pages: 1 });
  if (!stripMetadata) pipeline = pipeline.withMetadata();

  if (maxWidth > 0 && meta.width && meta.width > maxWidth) {
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }

  const sourceFormat = (meta.format || '').toLowerCase();
  const outFormat = (targetFormat || sourceFormat).toLowerCase();

  let outputBuffer;
  try {
    switch (outFormat) {
      case 'jpeg':
      case 'jpg':
        outputBuffer = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: preset.jpeg, mozjpeg: true, progressive: true, optimizeScans: true }).toBuffer();
        break;
      case 'webp':
        outputBuffer = await pipeline.webp({ quality: preset.webp, effort: 6 }).toBuffer();
        break;
      case 'avif':
        outputBuffer = await pipeline.avif({ quality: preset.avif, effort: 6 }).toBuffer();
        break;
      case 'heif':
      case 'heic':
        try {
          outputBuffer = await pipeline.heif({ quality: preset.heif, compression: 'hevc', effort: 6 }).toBuffer();
        } catch (_hevcErr) {
          outputBuffer = await makeSharp(buffer).heif({ quality: preset.heif, compression: 'av1', effort: 6 }).toBuffer();
        }
        break;
      case 'tiff':
      case 'tif':
        outputBuffer = await pipeline.tiff({ quality: preset.tiff, compression: 'lzw' }).toBuffer();
        break;
      case 'png':
        outputBuffer = preset.pngPalette
          ? await pipeline.png({ compressionLevel: preset.pngCompression, palette: true, effort: 10, colours: 256 }).toBuffer()
          : await pipeline.png({ compressionLevel: preset.pngCompression, effort: 10 }).toBuffer();
        break;
      case 'gif':
        outputBuffer = await pipeline.gif({ effort: 10 }).toBuffer();
        break;
      case 'jp2':
        outputBuffer = await pipeline.jp2({ quality: preset.jpeg }).toBuffer();
        break;
      case 'jxl':
        outputBuffer = await pipeline.jxl({ distance: Math.max(0.1, (100 - preset.jpeg) / 20) }).toBuffer();
        break;
      case 'bmp':
        outputBuffer = buffer;
        break;
      default:
        outputBuffer = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: preset.jpeg, mozjpeg: true, progressive: true }).toBuffer();
        break;
    }
  } catch (e) {
    try {
      outputBuffer = await makeSharp(buffer).webp({ quality: preset.webp }).toBuffer();
    } catch (_fallbackError) {
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
  PRESETS,
  MAX_INPUT_PIXELS
};
