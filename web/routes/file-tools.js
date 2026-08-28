const express = require('express');
const router = express.Router();
const path = require('path');
const { pipeline } = require('stream/promises');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const {
  prepareJob,
  sendProgress,
  endProgress,
  throwIfCancelled,
  getJobSignal,
  JobCancelledError
} = require('./progress');
const { findDuplicates } = require('../../core/duplicateFinder');
const { generateManifest, verifyManifest, toChecksumText } = require('../../core/checksumManifest');
const { normalizeFile, DEFAULT_MAX_TEXT_BYTES } = require('../../core/textNormalizer');
const { createVerifiedReadStream } = require('../../core/processingEngine');
const { writeZip } = require('../../core/archiveEngine');

const MANIFEST_FIELD_LIMIT = 120 * 1024;

function attachCleanup(res, jobId) {
  const onEnd = () => cleanupJob(jobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);
}

function manifestItems(files, paths) {
  return files.map((file, index) => ({ filePath: file.path, relativePath: paths[index], size: file.size }));
}

function jobCoreOptions(jobId) {
  return {
    signal: getJobSignal(jobId),
    checkCancelled: () => throwIfCancelled(jobId)
  };
}

function isCancellationError(error, jobId) {
  if (error instanceof JobCancelledError || error?.code === 'PROCESSING_ABORTED') return true;
  try {
    throwIfCancelled(jobId);
  } catch (cancelError) {
    return cancelError instanceof JobCancelledError;
  }
  return false;
}

function declaredTotalBytes(files) {
  let total = 0;
  for (const file of files) {
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Uploaded file size metadata is invalid.');
    total += size;
    if (!Number.isSafeInteger(total)) throw new Error('Uploaded file total exceeds the safe integer range.');
  }
  return total;
}

router.post('/checksums/generate', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const files = req.files || [];
  const paths = req.safePaths || [];
  const jobId = req.jobId;
  attachCleanup(res, jobId);

  if (!files.length) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const output = String(req.body.outputFormat || 'json').toLowerCase();
  if (!['json', 'manifest', 'sha256'].includes(output)) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Unsupported checksum output format.' });
  }

  try {
    const manifest = await generateManifest(manifestItems(files, paths), {
      ...jobCoreOptions(jobId),
      onHashed: ({ item, size }) => sendProgress(jobId, {
        event: 'file', file: item.relativePath, type: 'scan', originalSize: size, compressedSize: size
      })
    });
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
    if (isCancellationError(err, jobId)) {
      endProgress(jobId, 'cancelled');
      return res.status(499).json({ error: 'Processing cancelled.' });
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

  if (!files.length) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const manifestJson = String(req.body.manifestJson || '');
  if (!manifestJson || Buffer.byteLength(manifestJson, 'utf8') > MANIFEST_FIELD_LIMIT) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Manifest JSON is missing or exceeds the 120 KB verification limit.' });
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestJson);
  } catch (_error) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Manifest JSON is invalid.' });
  }

  try {
    const report = await verifyManifest(manifestItems(files, paths), manifest, {
      ...jobCoreOptions(jobId),
      onHashed: ({ item, size }) => sendProgress(jobId, {
        event: 'file', file: item.relativePath, type: 'scan', originalSize: size, compressedSize: size
      })
    });
    endProgress(jobId, 'completed');
    res.setHeader('Cache-Control', 'no-store');
    return res.json(report);
  } catch (err) {
    if (isCancellationError(err, jobId)) {
      endProgress(jobId, 'cancelled');
      return res.status(499).json({ error: 'Processing cancelled.' });
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
      ...jobCoreOptions(jobId),
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
    if (isCancellationError(err, jobId)) {
      endProgress(jobId, 'cancelled');
      return res.status(499).json({ error: 'Processing cancelled.' });
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

  if (!files.length) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const lineEnding = String(req.body.lineEnding || 'lf').toLowerCase();
  const encodingMode = String(req.body.encodingMode || 'utf8').toLowerCase();
  if (!['preserve', 'lf', 'crlf'].includes(lineEnding) || !['preserve', 'utf8', 'utf8-bom'].includes(encodingMode)) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Unsupported normalization settings.' });
  }

  const processOne = async (file, relativePath) => {
    const result = await normalizeFile(file.path, {
      lineEnding,
      encodingMode,
      expectedSize: file.size,
      maxBytes: DEFAULT_MAX_TEXT_BYTES,
      ...jobCoreOptions(jobId)
    });
    sendProgress(jobId, {
      event: 'file',
      file: relativePath,
      type: result.skipped ? 'skip' : 'process',
      originalSize: result.inputBytes,
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

    const entries = files.map((file, index) => ({
      name: safeRelativePath(paths[index]),
      size: file.size,
      open: async () => (await processOne(file, paths[index])).output
    }));

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="normalized-${Date.now()}.zip"`);
    await writeZip(res, entries, {
      level: 9,
      maxBufferBytes: DEFAULT_MAX_TEXT_BYTES,
      maxTotalBytes: declaredTotalBytes(files),
      ...jobCoreOptions(jobId)
    });
  } catch (err) {
    if (isCancellationError(err, jobId)) {
      endProgress(jobId, 'cancelled');
      if (!res.headersSent) return res.status(499).json({ error: 'Processing cancelled.' });
      if (!res.writableEnded) res.end();
      return;
    }
    console.error('[Text Normalizer Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) {
      const status = err?.code === 'FILE_SIZE_LIMIT' || err?.code === 'ARCHIVE_BUFFER_LIMIT' ? 413 : 500;
      return res.status(status).json({ error: err?.code === 'FILE_SIZE_LIMIT' ? 'A text file exceeds the 32 MB normalization memory limit.' : 'Text normalization failed.' });
    }
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

  try {
    if (files.length === 1) {
      const outName = path.basename(renamer(paths[0], 0));
      const source = createVerifiedReadStream(files[0].path, {
        expectedSize: files[0].size,
        ...jobCoreOptions(jobId),
        onComplete: ({ bytes }) => sendProgress(jobId, {
          event: 'file', file: paths[0], type: 'process', originalSize: bytes, compressedSize: bytes
        })
      });
      res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      await pipeline(source, res);
      return;
    }

    const usedNames = new Set();
    const entries = files.map((file, index) => {
      const sourcePath = organizeByExtension === 'true' ? path.posix.basename(paths[index]) : paths[index];
      const candidate = renamer(sourcePath, index);
      let uniquePath = candidate;
      let counter = 1;
      while (usedNames.has(uniquePath.toLocaleLowerCase('en-US'))) {
        const parsed = path.posix.parse(candidate);
        uniquePath = safeRelativePath(path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`));
        counter++;
      }
      usedNames.add(uniquePath.toLocaleLowerCase('en-US'));
      return {
        name: uniquePath,
        filePath: file.path,
        size: file.size,
        sourcePath: paths[index]
      };
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="renamed-${Date.now()}.zip"`);
    await writeZip(res, entries, {
      level: 9,
      maxTotalBytes: declaredTotalBytes(files),
      ...jobCoreOptions(jobId),
      onEntryComplete: ({ entry, outputBytes }) => sendProgress(jobId, {
        event: 'file',
        file: entry.sourcePath,
        type: 'process',
        originalSize: entry.size,
        compressedSize: outputBytes
      })
    });
  } catch (err) {
    if (isCancellationError(err, jobId)) {
      endProgress(jobId, 'cancelled');
      if (!res.headersSent) return res.status(499).json({ error: 'Processing cancelled.' });
      if (!res.writableEnded) res.end();
      return;
    }
    console.error('[Rename Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) {
      const userError = ['NON_PORTABLE_ARCHIVE_PATH', 'PORTABLE_ARCHIVE_COLLISION', 'ARCHIVE_PATH_TOO_LONG'].includes(err?.code);
      return res.status(userError ? 400 : 500).json({ error: userError ? err.message : 'Renaming failed.' });
    }
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;