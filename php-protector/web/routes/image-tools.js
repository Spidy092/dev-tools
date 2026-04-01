const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob } = require('../multer-setup');
const { resizeImage, convertImage } = require('../../core/imageProcessor');

// Helper for sending ZIP or Direct response
async function handleProcessResponse(res, files, paths, processor, jobId, renamer = null) {
    const isSingle = files.length === 1;
    const normalizedPaths = Array.isArray(paths) ? paths : [paths];

    // Cleanup job folder on response finalization or error
    const onEnd = () => { if (jobId) cleanupJob(jobId); };
    res.on('finish', onEnd);
    res.on('close', onEnd);

    if (isSingle) {
        try {
            const file = files[0];
            const relativePath = normalizedPaths[0] || file.originalname;
            const fileBuffer = fs.readFileSync(file.path);
            const processedBuffer = await processor(fileBuffer, relativePath);
            const outName = renamer ? renamer(relativePath) : relativePath;
            
            res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
            // Set basic content type based on extension
            const ext = path.extname(outName).toLowerCase();
            const mime = ext === '.webp' ? 'image/webp' : (ext === '.png' ? 'image/png' : 'image/jpeg');
            res.setHeader('Content-Type', mime);
            return res.send(processedBuffer);
        } catch (err) {
            console.error('[Single Process Error]', err);
            return res.status(500).send('Processing failed');
        }
    }

    // Bulk Mode -> ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="processed-${Date.now()}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
        console.error('[Archive Error]', err);
        if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
    });
    archive.pipe(res);

    try {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.gif'];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            let relativePath = normalizedPaths[i] || file.originalname;
            const ext = path.extname(relativePath).toLowerCase();
            const fileBuffer = fs.readFileSync(file.path);

            if (imageExtensions.includes(ext)) {
                const processedBuffer = await processor(fileBuffer, relativePath);
                const outPath = renamer ? renamer(relativePath) : relativePath;
                archive.append(processedBuffer, { name: outPath });
            } else {
                archive.append(fileBuffer, { name: relativePath });
            }
        }
        archive.finalize();
    } catch (err) {
        console.error('[Bulk Process Error]', err);
        archive.finalize(); 
    }
}

// POST /image/resize
router.post('/resize', upload.array('files'), (req, res) => {
    const { width, height, fit, background, grayscale, blur, negate, sharpen } = req.body;
    const files = req.files;
    const paths = req.body.paths;
    const jobId = (files && files.length > 0) ? files[0].destination.split('/').pop() : null;

    if (!files || files.length === 0) return res.status(400).send('No files uploaded');

    handleProcessResponse(res, files, paths, async (buffer) => {
        return resizeImage(buffer, { width, height, fit, background, grayscale, blur, negate, sharpen });
    }, jobId);
});

// POST /image/convert
router.post('/convert', upload.array('files'), (req, res) => {
    const { quality, targetFormat, grayscale, blur, negate, sharpen } = req.body;
    const files = req.files;
    const paths = req.body.paths;
    const jobId = (files && files.length > 0) ? files[0].destination.split('/').pop() : null;

    if (!files || files.length === 0) return res.status(400).send('No files uploaded');

    handleProcessResponse(res, files, paths, async (buffer) => {
        return convertImage(buffer, { quality, format: targetFormat, grayscale, blur, negate, sharpen });
    }, jobId, (relativePath) => {
        const ext = targetFormat || 'webp';
        return relativePath.replace(/\.[^/.]+$/, "") + "." + ext;
    });
});

module.exports = router;
