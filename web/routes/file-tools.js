const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { prepareJob, sendProgress, endProgress, throwIfCancelled, JobCancelledError } = require('./progress');

router.post('/rename', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const { casing, separator, strictClean, collapseHyphens, organizeByExtension, renamePattern } = req.body;
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

  const sanitizeName = name => {
    let base = String(name || 'file');
    if (casing === 'lowercase') base = base.toLowerCase();
    else if (casing === 'uppercase') base = base.toUpperCase();
    const sepChar = separator === 'hyphen' ? '-' : separator === 'underscore' ? '_' : separator === 'none' ? '' : null;
    if (sepChar !== null) base = base.replace(/[.\s]/g, sepChar);
    if (strictClean === 'true') {
      const allowed = sepChar === '-' ? /[^a-zA-Z0-9-]/g : sepChar === '_' ? /[^a-zA-Z0-9_]/g : /[^a-zA-Z0-9]/g;
      base = base.replace(allowed, '');
    }
    if (collapseHyphens === 'true') {
      if (sepChar === '-') base = base.replace(/-+/g, '-');
      if (sepChar === '_') base = base.replace(/_+/g, '_');
    }
    return base || 'file';
  };

  const flatInput = paths.every(p => !p.includes('/'));
  const renamer = (relativePath, index) => {
    const parsed = path.posix.parse(relativePath);
    const patterned = renamePattern ? renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1) : parsed.name;
    const newName = sanitizeName(patterned);
    let ext = parsed.ext;
    if (casing === 'lowercase') ext = ext.toLowerCase();
    else if (casing === 'uppercase') ext = ext.toUpperCase();
    let finalPath = path.posix.join(parsed.dir, newName + ext);
    if (organizeByExtension === 'true') {
      const extName = ext.replace('.', '').toUpperCase();
      const folder = extName ? `${extName}_Files` : 'Other_Files';
      finalPath = flatInput ? path.posix.join(folder, newName + ext) : path.posix.join(folder, finalPath);
    }
    return safeRelativePath(finalPath);
  };

  if (files.length === 1) {
    try {
      throwIfCancelled(jobId);
      const outName = path.basename(renamer(paths[0], 0));
      const output = await fs.promises.readFile(files[0].path);
      throwIfCancelled(jobId);
      sendProgress(jobId, { event: 'file', file: paths[0], type: 'process', originalSize: output.length, compressedSize: output.length });
      endProgress(jobId, 'completed');
      res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(output);
    } catch (err) {
      if (err instanceof JobCancelledError) {
        endProgress(jobId, 'cancelled');
        return res.status(499).json({ error: err.message });
      }
      console.error('[Single Rename Error]', err);
      endProgress(jobId, 'failed');
      return res.status(500).send('Processing failed');
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="renamed-${Date.now()}.zip"`);
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
      throwIfCancelled(jobId);
      const sourcePath = organizeByExtension === 'true' ? path.posix.basename(paths[i]) : paths[i];
      const candidate = renamer(sourcePath, i);
      let uniquePath = candidate;
      let counter = 1;
      while (usedNames.has(uniquePath)) {
        const parsed = path.posix.parse(candidate);
        uniquePath = safeRelativePath(path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`));
        counter++;
      }
      usedNames.add(uniquePath);
      const output = await fs.promises.readFile(files[i].path);
      throwIfCancelled(jobId);
      archive.append(output, { name: uniquePath });
      sendProgress(jobId, { event: 'file', file: paths[i], type: 'process', originalSize: output.length, compressedSize: output.length });
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
    console.error('[Bulk Rename Error]', err);
    endProgress(jobId, 'failed');
    try { archive.abort(); } catch (_) {}
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
