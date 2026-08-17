const sharp = require('sharp');

const MAX_INPUT_PIXELS = Number(process.env.MAX_IMAGE_PIXELS) || 100_000_000;
const MAX_OUTPUT_DIMENSION = Number(process.env.MAX_IMAGE_OUTPUT_WIDTH) || 16_384;

function makeSharp(buffer) {
  return sharp(buffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS });
}

function clampDimension(value) {
  const parsed = parseInt(value, 10) || null;
  return parsed ? Math.min(Math.max(parsed, 1), MAX_OUTPUT_DIMENSION) : null;
}

async function resizeImage(buffer, options = {}) {
  const width = clampDimension(options.width);
  const height = clampDimension(options.height);
  const allowedFits = new Set(['cover', 'contain', 'fill', 'inside', 'outside']);
  const fit = allowedFits.has(options.fit) ? options.fit : 'cover';
  const background = /^#[0-9a-fA-F]{6}$/.test(options.background || '') ? options.background : '#ffffff';
  const strategy = fit === 'cover' ? 'attention' : undefined;

  let pipeline = makeSharp(buffer).resize({
    width,
    height,
    fit,
    background,
    withoutEnlargement: true,
    position: strategy
  });

  if (options.grayscale === 'true') pipeline = pipeline.grayscale();
  if (options.blur) pipeline = pipeline.blur(Math.min(100, Math.max(0.3, parseFloat(options.blur) || 0.3)));
  if (options.negate === 'true') pipeline = pipeline.negate();
  if (options.sharpen === 'true') pipeline = pipeline.sharpen();

  return pipeline.toBuffer();
}

async function convertImage(buffer, options = {}) {
  const allowedFormats = new Set(['jpeg', 'jpg', 'png', 'avif', 'tiff', 'webp']);
  const format = allowedFormats.has(String(options.format || '').toLowerCase()) ? String(options.format).toLowerCase() : 'webp';
  const quality = Math.min(100, Math.max(1, parseInt(options.quality, 10) || 80));

  let pipeline = makeSharp(buffer);
  if (options.grayscale === 'true') pipeline = pipeline.grayscale();
  if (options.blur) pipeline = pipeline.blur(Math.min(100, Math.max(0.3, parseFloat(options.blur) || 0.3)));
  if (options.negate === 'true') pipeline = pipeline.negate();
  if (options.sharpen === 'true') pipeline = pipeline.sharpen();

  switch (format) {
    case 'jpeg':
    case 'jpg': return pipeline.jpeg({ quality }).toBuffer();
    case 'png': return pipeline.png({ compressionLevel: 9 }).toBuffer();
    case 'avif': return pipeline.avif({ quality }).toBuffer();
    case 'tiff': return pipeline.tiff({ quality }).toBuffer();
    default: return pipeline.webp({ quality }).toBuffer();
  }
}

module.exports = { resizeImage, convertImage, MAX_INPUT_PIXELS };
