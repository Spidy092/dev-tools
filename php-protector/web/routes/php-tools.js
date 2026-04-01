const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const { upload, cleanupJob } = require('../multer-setup');
const { obfuscateCode } = require('../../core/obfuscator');
const fs = require('fs');
const path = require('path');

// POST /upload — handles project folder upload for PHP Protection
router.post('/upload', upload.array('files'), (req, res) => {
  const files = req.files;
  const paths = req.body.paths; 
  const jobId = (files && files.length > 0) ? files[0].destination.split('/').pop() : null;

  if (!files || files.length === 0) {
    console.error('[Upload] No files received');
    return res.status(400).json({ error: 'No files received' });
  }

  const onEnd = () => { if (jobId) cleanupJob(jobId); };
  res.on('finish', onEnd);
  res.on('close', onEnd);

  if (files.length === 1) {
    // Single File Mode
    try {
      const file = files[0];
      const relativePath = (Array.isArray(paths) ? paths[0] : paths) || file.originalname;
      const fileContent = fs.readFileSync(file.path);
      const ext = path.extname(relativePath).toLowerCase();

      if (ext === '.php') {
        const protectedCode = obfuscateCode(fileContent.toString('utf8'));
        res.setHeader('Content-Type', 'text/plain'); // Or 'application/x-httpd-php'
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        return res.send(Buffer.from(protectedCode, 'utf8'));
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        return res.sendFile(file.path);
      }
    } catch (err) {
      console.error('[Single PHP Error]', err);
      return res.status(500).send('Obfuscation failed');
    }
  }

  // Bulk Folder Mode -> ZIP
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="protected.zip"');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('[Archive Error]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
  });
  archive.pipe(res);

  try {
    const normalizedPaths = Array.isArray(paths) ? paths : [paths];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = normalizedPaths[i] || file.originalname;
      const ext = relativePath.split('.').pop().toLowerCase();
      const fileContent = fs.readFileSync(file.path);

      if (ext === 'php') {
        const protectedCode = obfuscateCode(fileContent.toString('utf8'));
        archive.append(Buffer.from(protectedCode, 'utf8'), { name: relativePath });
      } else {
        archive.append(fileContent, { name: relativePath });
      }
    }
    archive.finalize();
  } catch (err) {
    console.error('[Bulk PHP Error]', err);
    archive.finalize();
  }
});

module.exports = router;
