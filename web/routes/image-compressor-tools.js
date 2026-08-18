const express = require('express');
const router = express.Router();
const path = require('path');
const { pipeline } = require('stream/promises');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { readFileBuffer, createVerifiedReadStream } = require('../../core/processingEngine');
const { writeZip } = require('../../core/archiveEngine');
const { RESOURCE_POLICY, totalDeclaredBytes } = require('../../core/resourcePolicy');
const {
  prepareJob,
  sendProgress,
  endProgress,
  throwIfCancelled,
  getJobSignal,
  JobCancelledError
} = require('./progress');
const { compressImage, buildOutputName, SUPPORTED_INPUTS } = require('../../core/imageCompressor');

function coreOptions(jobId) {
  return { signal: getJobSignal(jobId), checkCancelled: () => throwIfCancelled(jobId) };
}

function cancelled(error, jobId) {
  if (error instanceof JobCancelledError || error?.code === 'PROCESSING_ABORTED') return true;
  try { throwIfCancelled(jobId); } catch (err) { return err instanceof JobCancelledError; }
  return false;
}

function mimeFor(name) {
  const ext = path.extname(name).toLowerCase();
  const mimeMap = {
    '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif',
    '.heif':'image/heif','.heic':'image/heic','.tiff':'image/tiff','.tif':'image/tiff','.gif':'image/gif',
    '.bmp':'image/bmp','.svg':'image/svg+xml','.jp2':'image/jp2','.jxl':'image/jxl'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

router.post('/compress', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const {
    level = 'medium', customQuality = '80', maxWidth = '0',
    stripMetadata = 'true', targetFormat = ''
  } = req.body;

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

  const normalizedTarget = targetFormat && targetFormat !== 'keep'
    ? String(targetFormat).toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';

  const isSupported = relativePath => SUPPORTED_INPUTS.has(path.extname(relativePath).toLowerCase());
  const isGuaranteedPassThrough = relativePath => {
    const ext = path.extname(relativePath).toLowerCase();
    return !SUPPORTED_INPUTS.has(ext) || ext === '.svg';
  };

  const renamedPath = relativePath => {
    if (!normalizedTarget) return safeRelativePath(relativePath);
    const parsed = path.posix.parse(relativePath);
    return safeRelativePath(path.posix.join(parsed.dir, buildOutputName(parsed.base, normalizedTarget)));
  };

  const processOne = async (file, relativePath) => {
    const read = await readFileBuffer(file.path, {
      expectedSize: file.size,
      maxBytes: RESOURCE_POLICY.imageBufferBytes,
      ...coreOptions(jobId)
    });
    throwIfCancelled(jobId);
    const result = await compressImage(read.buffer, {
      level,
      customQuality: parseInt(customQuality, 10) || 80,
      maxWidth: parseInt(maxWidth, 10) || 0,
      stripMetadata: stripMetadata === 'true' || stripMetadata === true,
      targetFormat: normalizedTarget
    });
    throwIfCancelled(jobId);
    if (!Buffer.isBuffer(result.buffer)) throw new Error('Image compressor returned an invalid output buffer.');
    if (result.buffer.length > RESOURCE_POLICY.imageBufferBytes) {
      const error = new RangeError('Compressed image exceeds the configured image output memory budget.');
      error.code = 'IMAGE_OUTPUT_LIMIT';
      throw error;
    }
    const outputPath = result.skipped ? safeRelativePath(relativePath) : renamedPath(relativePath);
    sendProgress(jobId, {
      event: 'file', file: relativePath, type: result.skipped ? 'skip' : 'compress',
      originalSize: result.originalSize, compressedSize: result.compressedSize, reduction: result.reduction
    });
    return { result, outputPath };
  };

  try {
    const totalBytes = totalDeclaredBytes(files, RESOURCE_POLICY.coreBatchBytes);

    if (files.length === 1) {
      const file = files[0];
      const relativePath = paths[0];
      if (!isSupported(relativePath)) {
        const source = createVerifiedReadStream(file.path, {
          expectedSize: file.size,
          ...coreOptions(jobId),
          onComplete: ({ bytes }) => sendProgress(jobId, {
            event: 'file', file: relativePath, type: 'skip',
            originalSize: bytes, compressedSize: bytes, reduction: 0
          })
        });
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        await pipeline(source, res);
        return;
      }

      const processed = await processOne(file, relativePath);
      res.setHeader('Content-Type', mimeFor(processed.outputPath));
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(processed.outputPath)}"`);
      endProgress(jobId, 'completed');
      return res.end(processed.result.buffer);
    }

    const usedNames = new Set();
    const entries = files.map((file, index) => {
      const relativePath = paths[index];
      const passthrough = isGuaranteedPassThrough(relativePath);
      const candidate = passthrough ? safeRelativePath(relativePath) : renamedPath(relativePath);
      let finalPath = candidate;
      let counter = 1;
      while (usedNames.has(finalPath.toLocaleLowerCase('en-US'))) {
        const parsed = path.posix.parse(candidate);
        finalPath = safeRelativePath(path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`));
        counter++;
      }
      usedNames.add(finalPath.toLocaleLowerCase('en-US'));

      if (passthrough) {
        return {
          name: finalPath,
          filePath: file.path,
          size: file.size,
          sourcePath: relativePath,
          transformed: false
        };
      }

      return {
        name: finalPath,
        size: file.size,
        sourcePath: relativePath,
        transformed: true,
        open: async () => {
          const processed = await processOne(file, relativePath);
          if (processed.outputPath !== candidate) {
            const error = new Error('Image output path changed after archive planning.');
            error.code = 'IMAGE_OUTPUT_PATH_MISMATCH';
            throw error;
          }
          return processed.result.buffer;
        }
      };
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="compressed-images-${Date.now()}.zip"`);
    await writeZip(res, entries, {
      level: 6,
      maxBufferBytes: RESOURCE_POLICY.imageBufferBytes,
      maxTotalBytes: totalBytes,
      ...coreOptions(jobId),
      onEntryComplete: ({ entry, outputBytes }) => {
        if (entry.transformed) return;
        sendProgress(jobId, {
          event: 'file', file: entry.sourcePath, type: 'skip',
          originalSize: entry.size, compressedSize: outputBytes, reduction: 0
        });
      }
    });
  } catch (err) {
    if (cancelled(err, jobId)) {
      endProgress(jobId, 'cancelled');
      if (!res.headersSent) return res.status(499).json({ error: 'Processing cancelled.' });
      if (!res.writableEnded) res.end();
      return;
    }
    console.error('[Image Compress Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) {
      if (err?.code === 'FILE_SIZE_LIMIT' || err?.code === 'IMAGE_OUTPUT_LIMIT' || err?.code === 'ARCHIVE_BUFFER_LIMIT') {
        return res.status(413).json({ error: 'An image exceeds the configured image-processing memory budget.' });
      }
      if (err?.code === 'CORE_BATCH_LIMIT') return res.status(413).json({ error: 'The selected image batch exceeds the core resource budget.' });
      if (['NON_PORTABLE_ARCHIVE_PATH', 'PORTABLE_ARCHIVE_COLLISION', 'ARCHIVE_PATH_TOO_LONG'].includes(err?.code)) return res.status(400).json({ error: err.message });
      return res.status(500).json({ error: 'Image compression failed.' });
    }
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
