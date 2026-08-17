const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles } = require('../security');
const { compressPDF } = require('../../core/pdfProcessor');

router.post('/compress', upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const { pdfLevel } = req.body;
  const files = req.files;
  const paths = req.safePaths;
  const jobId = files[0].destination.split('/').pop();

  const onEnd = () => cleanupJob(jobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);

  if (files.length === 1) {
    (async () => {
      try {
        const file = files[0];
        const relativePath = paths[0];
        if (path.extname(relativePath).toLowerCase() !== '.pdf') {
          return res.status(415).json({ error: 'PDF Compressor accepts PDF files only.' });
        }
        const compressedPath = file.path + '-compressed.pdf';
        const result = await compressPDF(file.path, compressedPath, pdfLevel || '/screen');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        res.setHeader('Content-Type', 'application/pdf');
        fs.createReadStream(result.outputPath).pipe(res);
      } catch (err) {
        console.error('[Single PDF Error]', err);
        if (!res.headersSent) res.status(500).send('Compression failed');
      }
    })();
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="compressed-pdfs-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('[Archive Error]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
  });
  archive.pipe(res);

  (async () => {
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = paths[i];
        if (path.extname(relativePath).toLowerCase() === '.pdf') {
          const compressedPath = file.path + '-compressed.pdf';
          try {
            const result = await compressPDF(file.path, compressedPath, pdfLevel || '/screen');
            archive.append(fs.createReadStream(result.outputPath), { name: relativePath });
          } catch (err) {
            console.warn(`[PDF fallback] ${relativePath}:`, err.message);
            archive.append(fs.createReadStream(file.path), { name: relativePath });
          }
        } else {
          archive.append(fs.createReadStream(file.path), { name: relativePath });
        }
      }
      archive.finalize();
    } catch (err) {
      console.error('[Bulk PDF Error]', err);
      try { archive.finalize(); } catch (_) {}
    }
  })();
});

module.exports = router;
