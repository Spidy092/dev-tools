const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { createJobId, sendProgress, endProgress } = require('./progress');
const { compressImage, buildOutputName, SUPPORTED_INPUTS } = require('../../core/imageCompressor');

router.post('/compress', upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const {
    level = 'medium', customQuality = '80', maxWidth = '0',
    stripMetadata = 'true', targetFormat = ''
  } = req.body;

  const files = req.files || [];
  const paths = req.safePaths;
  const jobId = createJobId();
  res.setHeader('X-Job-Id', jobId);

  const uploadJobId = files[0].destination.split('/').pop();
  const onEnd = () => cleanupJob(uploadJobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);

  const processor = async (buffer, relativePath) => {
    const isSupported = SUPPORTED_INPUTS.has(path.extname(relativePath).toLowerCase());
    if (!isSupported) {
      return { buffer, format: null, originalSize: buffer.length, compressedSize: buffer.length, reduction: 0, skipped: true, reason: 'Unsupported format — passed through.' };
    }
    return compressImage(buffer, {
      level,
      customQuality: parseInt(customQuality, 10) || 80,
      maxWidth: parseInt(maxWidth, 10) || 0,
      stripMetadata: stripMetadata === 'true' || stripMetadata === true,
      targetFormat: targetFormat && targetFormat !== 'keep' ? targetFormat : ''
    });
  };

  const renamer = relativePath => {
    if (!targetFormat || targetFormat === 'keep') return relativePath;
    const parsed = path.posix.parse(relativePath);
    return safeRelativePath(path.posix.join(parsed.dir, buildOutputName(parsed.base, targetFormat)));
  };

  if (files.length === 1) {
    (async () => {
      try {
        const file = files[0];
        const relativePath = paths[0];
        const result = await processor(await fs.promises.readFile(file.path), relativePath);
        sendProgress(jobId, { event: 'file', file: relativePath, type: result.skipped ? 'skip' : 'compress', originalSize: result.originalSize, compressedSize: result.compressedSize, reduction: result.reduction });
        const outName = renamer(relativePath);
        const ext = path.extname(outName).toLowerCase();
        const mimeMap = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.heif':'image/heif','.heic':'image/heic','.tiff':'image/tiff','.tif':'image/tiff','.gif':'image/gif','.bmp':'image/bmp','.svg':'image/svg+xml','.jp2':'image/jp2','.jxl':'image/jxl' };
        res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(outName)}"`);
        res.end(result.buffer);
        endProgress(jobId);
      } catch (err) {
        console.error('[Single Compress Error]', err);
        endProgress(jobId);
        if (!res.headersSent) res.status(500).send('Compression failed');
        else res.end();
      }
    })();
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="compressed-images-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => {
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
        const relativePath = paths[i];
        const result = await processor(await fs.promises.readFile(files[i].path), relativePath);
        sendProgress(jobId, { event: 'file', file: relativePath, type: result.skipped ? 'skip' : 'compress', originalSize: result.originalSize, compressedSize: result.compressedSize, reduction: result.reduction });
        const outName = renamer(relativePath);
        let finalPath = outName;
        let counter = 1;
        while (usedNames.has(finalPath)) {
          const p = path.posix.parse(outName);
          finalPath = safeRelativePath(path.posix.join(p.dir, `${p.name}-${counter}${p.ext}`));
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
