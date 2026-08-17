const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { resizeImage, convertImage } = require('../../core/imageProcessor');

async function handleProcessResponse(res, files, paths, processor, jobId, renamer = null) {
  const onEnd = () => { if (jobId) cleanupJob(jobId); };
  res.on('finish', onEnd);
  res.on('close', onEnd);

  if (files.length === 1) {
    try {
      const relativePath = paths[0];
      const processedBuffer = await processor(await fs.promises.readFile(files[0].path), relativePath);
      const outName = safeRelativePath(renamer ? renamer(relativePath, 0) : relativePath);
      const ext = path.extname(outName).toLowerCase();
      const mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : ext === '.avif' ? 'image/avif' : 'image/jpeg';
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(outName)}"`);
      res.setHeader('Content-Type', mime);
      return res.send(processedBuffer);
    } catch (err) {
      console.error('[Single Image Process Error]', err);
      return res.status(500).send('Processing failed');
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="processed-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('[Archive Error]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
  });
  archive.pipe(res);

  try {
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.gif', '.avif']);
    const usedNames = new Set();

    for (let i = 0; i < files.length; i++) {
      const relativePath = paths[i];
      const ext = path.extname(relativePath).toLowerCase();
      const input = await fs.promises.readFile(files[i].path);
      const output = imageExtensions.has(ext) ? await processor(input, relativePath) : input;
      const candidate = safeRelativePath(renamer && imageExtensions.has(ext) ? renamer(relativePath, i) : relativePath);
      let finalPath = candidate;
      let counter = 1;
      while (usedNames.has(finalPath)) {
        const p = path.posix.parse(candidate);
        finalPath = safeRelativePath(path.posix.join(p.dir, `${p.name}-${counter}${p.ext}`));
        counter++;
      }
      usedNames.add(finalPath);
      archive.append(output, { name: finalPath });
    }
    archive.finalize();
  } catch (err) {
    console.error('[Bulk Image Process Error]', err);
    try { archive.finalize(); } catch (_) {}
  }
}

router.post('/resize', upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const { width, height, fit, background, grayscale, blur, negate, sharpen, renamePattern } = req.body;
  const files = req.files;
  const jobId = files[0].destination.split('/').pop();

  handleProcessResponse(res, files, req.safePaths, buffer =>
    resizeImage(buffer, { width, height, fit, background, grayscale, blur, negate, sharpen }),
  jobId, (relativePath, index) => {
    if (!renamePattern) return relativePath;
    const parsed = path.posix.parse(relativePath);
    const newName = renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1);
    return path.posix.join(parsed.dir, newName + parsed.ext);
  });
});

router.post('/convert', upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const { quality, targetFormat, grayscale, blur, negate, sharpen, renamePattern } = req.body;
  const files = req.files;
  const jobId = files[0].destination.split('/').pop();

  handleProcessResponse(res, files, req.safePaths, buffer =>
    convertImage(buffer, { quality, format: targetFormat, grayscale, blur, negate, sharpen }),
  jobId, (relativePath, index) => {
    const ext = String(targetFormat || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
    const parsed = path.posix.parse(relativePath);
    const newName = renamePattern ? renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1) : parsed.name;
    return path.posix.join(parsed.dir, `${newName}.${ext}`);
  });
});

module.exports = router;
