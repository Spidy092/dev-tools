const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { resizeImage, convertImage } = require('../../core/imageProcessor');
const { prepareJob, sendProgress, endProgress, throwIfCancelled, JobCancelledError } = require('./progress');

async function handleProcessResponse(req, res, files, paths, processor, renamer = null) {
  const jobId = req.jobId;
  const onEnd = () => cleanupJob(jobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);

  if (!files.length) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const processOne = async (file, relativePath, index) => {
    throwIfCancelled(jobId);
    const ext = path.extname(relativePath).toLowerCase();
    const supported = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.gif', '.avif']);
    const input = await fs.promises.readFile(file.path);
    throwIfCancelled(jobId);
    const output = supported.has(ext) ? await processor(input, relativePath) : input;
    throwIfCancelled(jobId);
    sendProgress(jobId, {
      event: 'file',
      file: relativePath,
      type: supported.has(ext) ? 'process' : 'skip',
      originalSize: input.length,
      compressedSize: output.length
    });
    return {
      output,
      candidate: safeRelativePath(renamer && supported.has(ext) ? renamer(relativePath, index) : relativePath)
    };
  };

  if (files.length === 1) {
    try {
      const relativePath = paths[0];
      const result = await processOne(files[0], relativePath, 0);
      const outName = result.candidate;
      const ext = path.extname(outName).toLowerCase();
      const mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : ext === '.avif' ? 'image/avif' : 'image/jpeg';
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(outName)}"`);
      res.setHeader('Content-Type', mime);
      endProgress(jobId, 'completed');
      return res.send(result.output);
    } catch (err) {
      if (err instanceof JobCancelledError) {
        endProgress(jobId, 'cancelled');
        return res.status(499).json({ error: err.message });
      }
      console.error('[Single Image Process Error]', err);
      endProgress(jobId, 'failed');
      return res.status(500).send('Processing failed');
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="processed-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('[Archive Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
  });
  archive.pipe(res);

  try {
    const usedNames = new Set();
    for (let i = 0; i < files.length; i++) {
      const result = await processOne(files[i], paths[i], i);
      let finalPath = result.candidate;
      let counter = 1;
      while (usedNames.has(finalPath)) {
        const p = path.posix.parse(result.candidate);
        finalPath = safeRelativePath(path.posix.join(p.dir, `${p.name}-${counter}${p.ext}`));
        counter++;
      }
      usedNames.add(finalPath);
      archive.append(result.output, { name: finalPath });
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
    console.error('[Bulk Image Process Error]', err);
    endProgress(jobId, 'failed');
    try { archive.abort(); } catch (_) {}
    if (!res.writableEnded) res.end();
  }
}

router.post('/resize', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const { width, height, fit, background, grayscale, blur, negate, sharpen, renamePattern } = req.body;
  handleProcessResponse(req, res, req.files || [], req.safePaths || [], buffer =>
    resizeImage(buffer, { width, height, fit, background, grayscale, blur, negate, sharpen }),
  (relativePath, index) => {
    if (!renamePattern) return relativePath;
    const parsed = path.posix.parse(relativePath);
    const newName = renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1);
    return path.posix.join(parsed.dir, newName + parsed.ext);
  });
});

router.post('/convert', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const { quality, targetFormat, grayscale, blur, negate, sharpen, renamePattern } = req.body;
  handleProcessResponse(req, res, req.files || [], req.safePaths || [], buffer =>
    convertImage(buffer, { quality, format: targetFormat, grayscale, blur, negate, sharpen }),
  (relativePath, index) => {
    const ext = String(targetFormat || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
    const parsed = path.posix.parse(relativePath);
    const newName = renamePattern ? renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1) : parsed.name;
    return path.posix.join(parsed.dir, `${newName}.${ext}`);
  });
});

module.exports = router;
