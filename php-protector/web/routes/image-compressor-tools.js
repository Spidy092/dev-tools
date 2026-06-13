const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { createJobId, sendProgress, endProgress } = require('./progress');
const { compressImage, buildOutputName, SUPPORTED_INPUTS } = require('../../core/imageCompressor');

/**
 * POST /image-compressor-tools/compress
 * Body fields:
 *   files          - uploaded files (multer)
 *   paths          - parallel array of relative paths
 *   level          - 'low' | 'medium' | 'high' | 'lossless' | 'custom'
 *   customQuality  - 1-100 (when level='custom')
 *   maxWidth       - optional cap on width (px)
 *   stripMetadata  - 'true' | 'false'
 *   targetFormat   - optional override (e.g. 'webp', 'jpeg', 'png', 'avif', 'keep')
 */
router.post('/compress', upload.array('files'), enforceTotalSize, (req, res) => {
    const {
        level = 'medium',
        customQuality = '80',
        maxWidth = '0',
        stripMetadata = 'true',
        targetFormat = ''
    } = req.body;

    const files = req.files || [];
    if (files.length === 0) return res.status(400).send('No files uploaded');

    const paths = Array.isArray(req.body.paths) ? req.body.paths : [req.body.paths];
    const jobId = createJobId();
    res.setHeader('X-Job-Id', jobId);

    // Cleanup job folder after response is done
    const onEnd = () => cleanupJob(files[0].destination.split('/').pop());
    res.on('finish', onEnd);
    res.on('close', onEnd);

    // Reusable processor function
    const processor = async (buffer, relativePath) => {
        const isSupported = SUPPORTED_INPUTS.has(path.extname(relativePath).toLowerCase());
        if (!isSupported) {
            // Pass through non-image files unchanged
            return { buffer, format: null, originalSize: buffer.length, compressedSize: buffer.length, reduction: 0, skipped: true, reason: 'Unsupported format — passed through.' };
        }
        return compressImage(buffer, {
            level,
            customQuality: parseInt(customQuality) || 80,
            maxWidth: parseInt(maxWidth) || 0,
            stripMetadata: stripMetadata === 'true' || stripMetadata === true,
            targetFormat: targetFormat && targetFormat !== 'keep' ? targetFormat : ''
        });
    };

    // Build renamer: swaps extension if user picked a target format
    const renamer = (relativePath, index) => {
        if (!targetFormat || targetFormat === 'keep') return relativePath;
        return buildOutputName(relativePath, targetFormat);
    };

    // ---- Single file path: stream result directly ----
    if (files.length === 1) {
        (async () => {
            try {
                const file = files[0];
                const relativePath = paths[0] || file.originalname;
                const fileBuffer = await fs.promises.readFile(file.path);
                const result = await processor(fileBuffer, relativePath);

                // Emit progress event so the UI log shows the result
                sendProgress(jobId, {
                    event: 'file',
                    file: relativePath,
                    type: result.skipped ? 'skip' : 'compress',
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    reduction: result.reduction
                });

                const outName = renamer(relativePath, 0);

                // Pick a sensible content-type
                const ext = path.extname(outName).toLowerCase();
                const mimeMap = {
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.png': 'image/png', '.webp': 'image/webp',
                    '.avif': 'image/avif', '.heif': 'image/heif',
                    '.heic': 'image/heic', '.tiff': 'image/tiff',
                    '.tif':  'image/tiff', '.gif': 'image/gif',
                    '.bmp':  'image/bmp',  '.svg': 'image/svg+xml',
                    '.jp2':  'image/jp2',  '.jxl': 'image/jxl'
                };
                res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
                res.setHeader('Content-Disposition', `attachment; filename="${path.basename(outName)}"`);
                res.end(result.buffer);

                endProgress(jobId);
            } catch (err) {
                console.error('[Single Compress Error]', err);
                endProgress(jobId);
                if (!res.headersSent) res.status(500).send('Compression failed: ' + err.message);
                else res.end();
            }
        })();
        return;
    }

    // ---- Bulk path: stream a ZIP of compressed results ----
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="compressed-images-${Date.now()}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
        console.error('[Archive Error]', err);
        endProgress(jobId);
        if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
    });
    archive.on('end', () => endProgress(jobId));
    archive.pipe(res);

    const usedNames = new Set();
    (async () => {
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const relativePath = paths[i] || file.originalname;
                const fileBuffer = await fs.promises.readFile(file.path);
                const result = await processor(fileBuffer, relativePath);

                sendProgress(jobId, {
                    event: 'file',
                    file: relativePath,
                    type: result.skipped ? 'skip' : 'compress',
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    reduction: result.reduction
                });

                // Compute a unique final name inside the ZIP
                let outName = renamer(relativePath, i);
                if (outName !== relativePath) {
                    // Extension was changed — also strip the old one from any path component
                    outName = path.posix.join(path.posix.dirname(relativePath), path.basename(outName));
                }
                let finalPath = outName;
                let counter = 1;
                while (usedNames.has(finalPath)) {
                    const p = path.parse(outName);
                    finalPath = (p.dir ? p.dir + '/' : '') + p.name + '-' + counter + p.ext;
                    counter++;
                }
                usedNames.add(finalPath);

                archive.append(result.buffer, { name: finalPath });
            }
            archive.finalize();
        } catch (err) {
            console.error('[Bulk Compress Error]', err);
            try { archive.finalize(); } catch (_) {}
            endProgress(jobId);
        }
    })();
});

module.exports = router;
