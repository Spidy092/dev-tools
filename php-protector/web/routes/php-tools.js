const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { upload, cleanupJob } = require('../multer-setup');
const { obfuscateCode } = require('../../core/obfuscator');
const { createJobId, sendProgress, endProgress } = require('./progress');

// POST /upload — handles project folder upload for PHP Protection
router.post('/upload', upload.array('files'), async (req, res) => {
  const files = req.files;
  const paths = req.body.paths;
  const jobId = req.jobId || ((files && files.length > 0) ? files[0].destination.split('/').pop() : null);
  const sseJobId = createJobId();

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files received' });
  }

  const onEnd = () => { if (jobId) cleanupJob(jobId); };
  res.on('finish', onEnd);
  res.on('close', onEnd);

  // Send SSE job ID in header so frontend can connect
  res.setHeader('X-Job-Id', sseJobId);

  if (files.length === 1) {
    try {
      const file = files[0];
      const relativePath = (Array.isArray(paths) ? paths[0] : paths) || file.originalname;
      const ext = path.extname(relativePath).toLowerCase();
      const fileContent = await fs.promises.readFile(file.path);

      if (ext === '.php') {
        const protectedCode = obfuscateCode(fileContent.toString('utf8'));
        sendProgress(sseJobId, { file: relativePath, type: 'php' });
        endProgress(sseJobId);
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        return res.send(Buffer.from(protectedCode, 'utf8'));
      } else {
        sendProgress(sseJobId, { file: relativePath, type: 'copy' });
        endProgress(sseJobId);
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        return res.sendFile(file.path);
      }
    } catch (err) {
      endProgress(sseJobId);
      return res.status(500).send('Obfuscation failed');
    }
  }

  // Bulk Mode -> ZIP with SSE progress
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="protected.zip"');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  archive.pipe(res);

  try {
    const normalizedPaths = Array.isArray(paths) ? paths : [paths];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = normalizedPaths[i] || file.originalname;
      const ext = path.extname(relativePath).toLowerCase();

      if (ext === '.php') {
        const fileContent = await fs.promises.readFile(file.path, 'utf8');
        const protectedCode = obfuscateCode(fileContent);
        archive.append(Buffer.from(protectedCode, 'utf8'), { name: relativePath });
      } else {
        archive.file(file.path, { name: relativePath });
      }
      sendProgress(sseJobId, { file: relativePath, type: ext === '.php' ? 'php' : 'copy' });
    }
    endProgress(sseJobId);
    archive.finalize();
  } catch (err) {
    sendProgress(sseJobId, { file: 'ERROR', type: 'error', message: err.message });
    endProgress(sseJobId);
    archive.append(Buffer.from(`Error: ${err.message}\n${err.stack || ''}`, 'utf8'), { name: 'ERROR.txt' });
    archive.finalize();
  }
});

module.exports = router;
