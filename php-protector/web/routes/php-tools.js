const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles } = require('../security');
const { obfuscateCode } = require('../../core/obfuscator');
const { createJobId, sendProgress, endProgress } = require('./progress');

router.post('/upload', upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const files = req.files;
  const paths = req.safePaths;
  const jobId = req.jobId || files[0].destination.split('/').pop();
  const sseJobId = createJobId();

  const onEnd = () => cleanupJob(jobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);
  res.setHeader('X-Job-Id', sseJobId);

  if (files.length === 1) {
    try {
      const file = files[0];
      const relativePath = paths[0];
      const ext = path.extname(relativePath).toLowerCase();
      const fileContent = await fs.promises.readFile(file.path);

      if (ext === '.php') {
        const protectedCode = obfuscateCode(fileContent.toString('utf8'));
        sendProgress(sseJobId, { file: relativePath, type: 'php' });
        endProgress(sseJobId);
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        return res.send(Buffer.from(protectedCode, 'utf8'));
      }

      sendProgress(sseJobId, { file: relativePath, type: 'copy' });
      endProgress(sseJobId);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
      return res.sendFile(file.path);
    } catch (err) {
      console.error('[PHP Protector Error]', err);
      endProgress(sseJobId);
      return res.status(500).send('Obfuscation failed');
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="protected.zip"');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('[PHP Archive Error]', err);
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);

  try {
    for (let i = 0; i < files.length; i++) {
      const relativePath = paths[i];
      const ext = path.extname(relativePath).toLowerCase();
      if (ext === '.php') {
        const fileContent = await fs.promises.readFile(files[i].path, 'utf8');
        archive.append(Buffer.from(obfuscateCode(fileContent), 'utf8'), { name: relativePath });
      } else {
        archive.file(files[i].path, { name: relativePath });
      }
      sendProgress(sseJobId, { file: relativePath, type: ext === '.php' ? 'php' : 'copy' });
    }
    endProgress(sseJobId);
    archive.finalize();
  } catch (err) {
    console.error('[PHP Bulk Error]', err);
    sendProgress(sseJobId, { file: 'ERROR', type: 'error' });
    endProgress(sseJobId);
    try { archive.finalize(); } catch (_) {}
  }
});

module.exports = router;
