const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob } = require('../multer-setup');
const { compressPDF } = require('../../core/pdfProcessor');

// POST /pdf/compress — handles single and bulk PDF compression
router.post('/compress', upload.array('files'), (req, res) => {
    const { pdfLevel } = req.body;
    const files = req.files;
    const paths = req.body.paths;
    const jobId = (files && files.length > 0) ? files[0].destination.split('/').pop() : null;

    if (!files || files.length === 0) return res.status(400).send('No files uploaded');

    const onEnd = () => { if (jobId) cleanupJob(jobId); };
    res.on('finish', onEnd);
    res.on('close', onEnd);

    if (files.length === 1) {
        // Single File Mode
        (async () => {
            try {
                const file = files[0];
                const relativePath = (Array.isArray(paths) ? paths[0] : paths) || file.originalname;
                const compressedPath = file.path + '-compressed.pdf';
                
                const result = await compressPDF(file.path, compressedPath, pdfLevel || '/screen');
                
                res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
                res.setHeader('Content-Type', 'application/pdf');
                fs.createReadStream(result.outputPath).pipe(res);
            } catch (err) {
                console.error('[Single PDF Error]', err);
                return res.status(500).send('Compression failed');
            }
        })();
        return;
    }

    // Bulk Folder Mode -> ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="compressed-pdfs-${Date.now()}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
        console.error('[Archive Error]', err);
        if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
    });
    archive.pipe(res);

    (async () => {
        try {
            const normalizedPaths = Array.isArray(paths) ? paths : [paths];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const relativePath = normalizedPaths[i] || file.originalname;
                if (path.extname(relativePath).toLowerCase() === '.pdf') {
                    const compressedPath = file.path + '-compressed.pdf';
                    try {
                        const result = await compressPDF(file.path, compressedPath, pdfLevel || '/screen');
                        archive.append(fs.createReadStream(result.outputPath), { name: relativePath });
                    } catch (err) {
                        archive.append(fs.createReadStream(file.path), { name: relativePath });
                    }
                } else {
                    archive.append(fs.createReadStream(file.path), { name: relativePath });
                }
            }
            archive.finalize();
        } catch (err) {
            console.error('[Bulk PDF Error]', err);
            archive.finalize(); 
        }
    })();
});

module.exports = router;
