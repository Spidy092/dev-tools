const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

/**
 * Advanced image processing using Sharp.
 */
async function resizeImage(buffer, options) {
    const width = parseInt(options.width) || null;
    const height = parseInt(options.height) || null;
    const fit = options.fit || 'cover';
    const background = options.background || '#ffffff';
    
    // 🔥 NEW: Strategy for smart focus cropping
    const strategy = (fit === 'cover' || fit === 'inside') ? 'attention' : undefined;

    let pipeline = sharp(buffer).resize({
        width,
        height,
        fit,
        background,
        withoutEnlargement: true,
        position: strategy
    });

    // 🔥 NEW: Filters
    if (options.grayscale === 'true') pipeline = pipeline.grayscale();
    if (options.blur) pipeline = pipeline.blur(parseFloat(options.blur) || 0.3);
    if (options.negate === 'true') pipeline = pipeline.negate();
    if (options.sharpen === 'true') pipeline = pipeline.sharpen();

    return pipeline.toBuffer();
}

/**
 * Converts image buffer with optional filters.
 */
async function convertImage(buffer, options) {
    const format = options.format || 'webp';
    const quality = parseInt(options.quality) || 80;

    let pipeline = sharp(buffer);

    // Apply the same filters to converter
    if (options.grayscale === 'true') pipeline = pipeline.grayscale();
    if (options.blur) pipeline = pipeline.blur(parseFloat(options.blur) || 0.3);
    if (options.negate === 'true') pipeline = pipeline.negate();
    if (options.sharpen === 'true') pipeline = pipeline.sharpen();

    switch (format.toLowerCase()) {
        case 'jpeg': case 'jpg': return pipeline.jpeg({ quality }).toBuffer();
        case 'png': return pipeline.png({ compressionLevel: 9 }).toBuffer();
        case 'avif': return pipeline.avif({ quality }).toBuffer();
        case 'tiff': return pipeline.tiff({ quality }).toBuffer();
        case 'webp': default: return pipeline.webp({ quality }).toBuffer();
    }
}

module.exports = { resizeImage, convertImage };
