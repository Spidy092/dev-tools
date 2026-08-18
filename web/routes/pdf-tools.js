const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles } = require('../security');
const { compressPDF } = require('../../core/pdfProcessor');
const { prepareJob, sendProgress, endProgress, throwIfCancelled, JobCancelledError } = require('./progress');

router.post('/compress', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const { pdfLevel } = req.body;
  const files = req.files || [];
  const paths = req.safePaths || [];
  const jobId = req.jobId;

  const onEnd = () => cleanupJob(jobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);

  if (!files.length) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  if (files.length === 1) {
    (async () => {
      try {
        throwIfCancelled(jobId);
        const file = files[0];
        const relativePath = paths[0];
        if (path.extname(relativePath).toLowerCase() !== '.pdf') {
          endProgress(jobId, 'failed');
          return res.status(415).json({ error: 'PDF Compressor accepts PDF files only.' });
        }
        const compressedPath = file.path + '-compressed.pdf';
        const result = await compressPDF(file.path, compressedPath, pdfLevel || '/screen');
        throwIfCancelled(jobId);
        sendProgress(jobId, { event: 'file', file: relativePath, type: 'compress', originalSize: result.originalSize, compressedSize: result.compressedSize, reduction: result.reduction });
        endProgress(jobId, 'completed');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        res.setHeader('Content-Type', 'application/pdf');
        fs.createReadStream(result.outputPath).pipe(res);
      } catch (err) {
        if (err instanceof JobCancelledError) {
          endProgress(jobId, 'cancelled');
          if (!res.headersSent) res.status(499).json({ error: err.message });
          else res.end();
          return;
        }
        console.error('[Single PDF Error]', err);
        endProgress(jobId, 'failed');
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
    endProgress(jobId, 'failed');
    if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
  });
  archive.pipe(res);

  (async () => {
    try {
      for (let i = 0; i < files.length; i++) {
        throwIfCancelled(jobId);
        const file = files[i];
        const relativePath = paths[i];
        if (path.extname(relativePath).toLowerCase() === '.pdf') {
          const compressedPath = file.path + '-compressed.pdf';
          try {
            const result = await compressPDF(file.path, compressedPath, pdfLevel || '/screen');
            throwIfCancelled(jobId);
            sendProgress(jobId, { event: 'file', file: relativePath, type: 'compress', originalSize: result.originalSize, compressedSize: result.compressedSize, reduction: result.reduction });
            archive.append(fs.createReadStream(result.outputPath), { name: relativePath });
          } catch (err) {
            if (err instanceof JobCancelledError) throw err;
            console.warn(`[PDF fallback] ${relativePath}:`, err.message);
            const stat = await fs.promises.stat(file.path);
            sendProgress(jobId, { event: 'file', file: relativePath, type: 'skip', originalSize: stat.size, compressedSize: stat.size });
            archive.append(fs.createReadStream(file.path), { name: relativePath });
          }
        } else {
          const stat = await fs.promises.stat(file.path);
          sendProgress(jobId, { event: 'file', file: relativePath, type: 'skip', originalSize: stat.size, compressedSize: stat.size });
          archive.append(fs.createReadStream(file.path), { name: relativePath });
        }
      }
      endProgress(jobId, 'completed');
      archive.finalize();
    } catch (err) {
      if (err instanceof JobCancelledError) {
        endProgress(jobId, 'cancelled');
        try { archive.abort(); } catch (_) {}
        if (!res.writableEnded) res.end();
        return;
      }
      console.error('[Bulk PDF Error]', err);
      endProgress(jobId, 'failed');
      try { archive.abort(); } catch (_) {}
      if (!res.writableEnded) res.end();
    }
  })();
});

module.exports = router;
