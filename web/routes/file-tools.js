const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { prepareJob, sendProgress, endProgress, throwIfCancelled, JobCancelledError } = require('./progress');
const { findDuplicates } = require('../../core/duplicateFinder');
const { generateManifest, verifyManifest, toChecksumText } = require('../../core/checksumManifest');
const { normalizeBuffer } = require('../../core/textNormalizer');

function attachCleanup(res, jobId) {
  const onEnd = () => cleanupJob(jobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);
}

function manifestItems(files, paths) {
  return files.map((file, index) => ({ filePath: file.path, relativePath: paths[index], size: file.size }));
}

router.post('/checksums/generate', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const files = req.files || [];
  const paths = req.safePaths || [];
  const jobId = req.jobId;
  attachCleanup(res, jobId);

  try {
    const manifest = await generateManifest(manifestItems(files, paths), {
      checkCancelled: () => throwIfCancelled(jobId),
      onHashed: ({ item, size }) => sendProgress(jobId, { event: 'file', file: item.relativePath, type: 'scan', originalSize: size, compressedSize: size })
    });
    const output = String(req.body.outputFormat || 'json').toLowerCase();
    endProgress(jobId, 'completed');
    res.setHeader('Cache-Control', 'no-store');
    if (output === 'sha256') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="checksums.sha256"');
      return res.send(toChecksumText(manifest));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="manifest.json"');
    return res.json(manifest);
  } catch (err) {
    if (err instanceof JobCancelledError) {
      endProgress(jobId, 'cancelled');
      return res.status(499).json({ error: err.message });
    }
    console.error('[Checksum Generate Error]', err);
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: err.message || 'Checksum generation failed.' });
  }
});

router.post('/checksums/verify', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const files = req.files || [];
  const paths = req.safePaths || [];
  const jobId = req.jobId;
  attachCleanup(res, jobId);

  let manifest;
  try {
    manifest = JSON.parse(String(req.body.manifestJson || ''));
  } catch (_error) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Manifest JSON is missing or invalid.' });
  }

  try {
    const report = await verifyManifest(manifestItems(files, paths), manifest, {
      checkCancelled: () => throwIfCancelled(jobId),
      onHashed: ({ item, size }) => sendProgress(jobId, { event: 'file', file: item.relativePath, type: 'scan', originalSize: size, compressedSize: size })
    });
    endProgress(jobId, 'completed');
    res.setHeader('Cache-Control', 'no-store');
    return res.json(report);
  } catch (err) {
    if (err instanceof JobCancelledError) {
      endProgress(jobId, 'cancelled');
      return res.status(499).json({ error: err.message });
    }
    console.error('[Checksum Verify Error]', err);
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: err.message || 'Manifest verification failed.' });
  }
});

router.post('/duplicates', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const files = req.files || [];
  const paths = req.safePaths || [];
  const jobId = req.jobId;
  attachCleanup(res, jobId);

  if (files.length < 2) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Select at least two files to find duplicates.' });
  }

  const minimumSize = Math.max(0, Number(req.body.minimumSizeBytes) || 0);
  const ignoreEmpty = req.body.ignoreEmpty !== 'false';
  const items = manifestItems(files, paths);

  try {
    const report = await findDuplicates(items, {
      minimumSize,
      ignoreEmpty,
      checkCancelled: () => throwIfCancelled(jobId),
      onHashed: ({ item, size }) => sendProgress(jobId, {
        event: 'file',
        file: item.relativePath,
        type: 'scan',
        originalSize: size,
        compressedSize: size
      })
    });
    endProgress(jobId, 'completed');
    res.setHeader('Cache-Control', 'no-store');
    return res.json(report);
  } catch (err) {
    if (err instanceof JobCancelledError) {
      endProgress(jobId, 'cancelled');
      return res.status(499).json({ error: err.message });
    }
    console.error('[Duplicate Finder Error]', err);
    endProgress(jobId, 'failed');
    return res.status(500).json({ error: 'Duplicate scan failed.' });
  }
});

router.post('/normalize-text', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const files = req.files || [];
  const paths = req.safePaths || [];
  const jobId = req.jobId;
  attachCleanup(res, jobId);

  const lineEnding = String(req.body.lineEnding || 'lf').toLowerCase();
  const encodingMode = String(req.body.encodingMode || 'utf8').toLowerCase();
  if (!['preserve', 'lf', 'crlf'].includes(lineEnding) || !['preserve', 'utf8', 'utf8-bom'].includes(encodingMode)) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Unsupported normalization settings.' });
  }

  const processOne = async (file, relativePath) => {
    throwIfCancelled(jobId);
    const input = await fs.promises.readFile(file.path);
    throwIfCancelled(jobId);
    const result = normalizeBuffer(input, { lineEnding, encodingMode });
    sendProgress(jobId, {
      event: 'file',
      file: relativePath,
      type: result.skipped ? 'skip' : 'process',
      originalSize: input.length,
      compressedSize: result.output.length,
      changed: result.changed,
      sourceEncoding: result.sourceEncoding,
      outputEncoding: result.outputEncoding,
      sourceLineEnding: result.sourceLineEnding,
      outputLineEnding: result.outputLineEnding,
      reason: result.reason
    });
    return result;
  };

  try {
    if (files.length === 1) {
      const result = await processOne(files[0], paths[0]);
      endProgress(jobId, 'completed');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(paths[0])}"`);
      return res.send(result.output);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="normalized-${Date.now()}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
      console.error('[Normalize Archive Error]', err);
      endProgress(jobId, 'failed');
      if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
    });
    archive.pipe(res);

    for (let i = 0; i < files.length; i++) {
      const result = await processOne(files[i], paths[i]);
      archive.append(result.output, { name: safeRelativePath(paths[i]) });
    }
    endProgress(jobId, 'completed');
    archive.finalize();
  } catch (err) {
    if (err instanceof JobCancelledError) {
      endProgress(jobId, 'cancelled');
      if (!res.headersSent) return res.status(499).json({ error: err.message });
      if (!res.writableEnded) res.end();
      return;
    }
    console.error('[Text Normalizer Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) return res.status(500).json({ error: 'Text normalization failed.' });
    if (!res.writableEnded) res.end();
  }
});

router.post('/rename', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const { casing, separator, strictClean, collapseHyphens, organizeByExtension, renamePattern } = req.body;
  const files = req.files || [];
  const paths = req.safePaths || [];
  const jobId = req.jobId;
  attachCleanup(res, jobId);

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
