const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles } = require('../security');
const { obfuscateCode } = require('../../core/obfuscator');
const { prepareJob, sendProgress, endProgress, throwIfCancelled, JobCancelledError } = require('./progress');

router.post('/upload', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
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
    try {
      throwIfCancelled(jobId);
      const file = files[0];
      const relativePath = paths[0];
      const ext = path.extname(relativePath).toLowerCase();
      const fileContent = await fs.promises.readFile(file.path);
      throwIfCancelled(jobId);

      if (ext === '.php') {
        const protectedCode = obfuscateCode(fileContent.toString('utf8'));
        sendProgress(jobId, { event: 'file', file: relativePath, type: 'php' });
        endProgress(jobId, 'completed');
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        return res.send(Buffer.from(protectedCode, 'utf8'));
      }

      sendProgress(jobId, { event: 'file', file: relativePath, type: 'copy' });
      endProgress(jobId, 'completed');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
      return res.sendFile(file.path);
    } catch (err) {
      if (err instanceof JobCancelledError) {
        endProgress(jobId, 'cancelled');
        return res.status(499).json({ error: err.message });
      }
      console.error('[PHP Protector Error]', err);
      endProgress(jobId, 'failed');
      return res.status(500).send('Obfuscation failed');
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="protected.zip"');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('[PHP Archive Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);

  try {
    for (let i = 0; i < files.length; i++) {
      throwIfCancelled(jobId);
      const relativePath = paths[i];
      const ext = path.extname(relativePath).toLowerCase();
      if (ext === '.php') {
        const fileContent = await fs.promises.readFile(files[i].path, 'utf8');
        throwIfCancelled(jobId);
        archive.append(Buffer.from(obfuscateCode(fileContent), 'utf8'), { name: relativePath });
      } else {
        archive.file(files[i].path, { name: relativePath });
      }
      sendProgress(jobId, { event: 'file', file: relativePath, type: ext === '.php' ? 'php' : 'copy' });
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
    console.error('[PHP Bulk Error]', err);
    sendProgress(jobId, { event: 'file', file: 'Batch', type: 'error' });
    endProgress(jobId, 'failed');
    try { archive.abort(); } catch (_) {}
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
