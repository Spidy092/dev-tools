const express = require('express');
const router = express.Router();
const path = require('path');
const { pipeline } = require('stream/promises');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { resizeImage, convertImage } = require('../../core/imageProcessor');
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

const SUPPORTED_IMAGES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.gif', '.avif']);

function coreOptions(jobId) {
  return { signal: getJobSignal(jobId), checkCancelled: () => throwIfCancelled(jobId) };
}

function cancelled(error, jobId) {
  if (error instanceof JobCancelledError || error?.code === 'PROCESSING_ABORTED') return true;
  try { throwIfCancelled(jobId); } catch (err) { return err instanceof JobCancelledError; }
  return false;
}

function mimeFor(name, supported) {
  if (!supported) return 'application/octet-stream';
  const ext = path.extname(name).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.avif': 'image/avif', '.tif': 'image/tiff',
    '.tiff': 'image/tiff', '.gif': 'image/gif'
  };
  return map[ext] || 'application/octet-stream';
}

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
    const ext = path.extname(relativePath).toLowerCase();
    const supported = SUPPORTED_IMAGES.has(ext);
    if (!supported) {
      return {
        supported: false,
        candidate: safeRelativePath(relativePath),
        output: null
      };
    }

    const read = await readFileBuffer(file.path, {
      expectedSize: file.size,
      maxBytes: RESOURCE_POLICY.imageBufferBytes,
      ...coreOptions(jobId)
    });
    throwIfCancelled(jobId);
    const output = await processor(read.buffer, relativePath);
    throwIfCancelled(jobId);
    if (!Buffer.isBuffer(output)) throw new Error('Image processor returned an invalid output buffer.');
    if (output.length > RESOURCE_POLICY.imageBufferBytes) {
      const error = new RangeError('Processed image exceeds the configured image output memory budget.');
      error.code = 'IMAGE_OUTPUT_LIMIT';
      throw error;
    }
    sendProgress(jobId, {
      event: 'file', file: relativePath, type: 'process',
      originalSize: read.bytes, compressedSize: output.length
    });
    return {
      supported: true,
      output,
      candidate: safeRelativePath(renamer ? renamer(relativePath, index) : relativePath)
    };
  };

  try {
    const totalBytes = totalDeclaredBytes(files, RESOURCE_POLICY.coreBatchBytes);

    if (files.length === 1) {
      const relativePath = paths[0];
      const supported = SUPPORTED_IMAGES.has(path.extname(relativePath).toLowerCase());
      if (!supported) {
        const source = createVerifiedReadStream(files[0].path, {
          expectedSize: files[0].size,
          ...coreOptions(jobId),
          onComplete: ({ bytes }) => sendProgress(jobId, {
            event: 'file', file: relativePath, type: 'skip', originalSize: bytes, compressedSize: bytes
          })
        });
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        await pipeline(source, res);
        return;
      }

      const result = await processOne(files[0], relativePath, 0);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(result.candidate)}"`);
      res.setHeader('Content-Type', mimeFor(result.candidate, true));
      endProgress(jobId, 'completed');
      return res.send(result.output);
    }

    const usedNames = new Set();
    const entries = files.map((file, index) => {
      const relativePath = paths[index];
      const supported = SUPPORTED_IMAGES.has(path.extname(relativePath).toLowerCase());
      const candidate = safeRelativePath(supported && renamer ? renamer(relativePath, index) : relativePath);
      let finalPath = candidate;
      let counter = 1;
      while (usedNames.has(finalPath.toLocaleLowerCase('en-US'))) {
        const parsed = path.posix.parse(candidate);
        finalPath = safeRelativePath(path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`));
        counter++;
      }
      usedNames.add(finalPath.toLocaleLowerCase('en-US'));

      if (!supported) {
        return { name: finalPath, filePath: file.path, size: file.size, sourcePath: relativePath, transformed: false };
      }
      return {
        name: finalPath,
        size: file.size,
        sourcePath: relativePath,
        transformed: true,
        open: async () => (await processOne(file, relativePath, index)).output
      };
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="processed-${Date.now()}.zip"`);
    await writeZip(res, entries, {
      level: 9,
      maxBufferBytes: RESOURCE_POLICY.imageBufferBytes,
      maxTotalBytes: totalBytes,
      ...coreOptions(jobId),
      onEntryComplete: ({ entry, outputBytes }) => {
        if (entry.transformed) return;
        sendProgress(jobId, {
          event: 'file', file: entry.sourcePath, type: 'skip',
          originalSize: entry.size, compressedSize: outputBytes
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
    console.error('[Image Process Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) {
      if (err?.code === 'FILE_SIZE_LIMIT' || err?.code === 'IMAGE_OUTPUT_LIMIT' || err?.code === 'ARCHIVE_BUFFER_LIMIT') {
        return res.status(413).json({ error: 'An image exceeds the configured image-processing memory budget.' });
      }
      if (err?.code === 'CORE_BATCH_LIMIT') return res.status(413).json({ error: 'The selected image batch exceeds the core resource budget.' });
      if (['NON_PORTABLE_ARCHIVE_PATH', 'PORTABLE_ARCHIVE_COLLISION', 'ARCHIVE_PATH_TOO_LONG'].includes(err?.code)) return res.status(400).json({ error: err.message });
      return res.status(500).json({ error: 'Image processing failed.' });
    }
    if (!res.writableEnded) res.end();
  }
}

router.post('/resize', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, (req, res) => {
  const { width, height, fit, background, grayscale, blur, negate, sharpen, renamePattern } = req.body;
  return handleProcessResponse(req, res, req.files || [], req.safePaths || [], buffer =>
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
  return handleProcessResponse(req, res, req.files || [], req.safePaths || [], buffer =>
    convertImage(buffer, { quality, format: targetFormat, grayscale, blur, negate, sharpen }),
  (relativePath, index) => {
    const ext = String(targetFormat || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
    const parsed = path.posix.parse(relativePath);
    const newName = renamePattern ? renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1) : parsed.name;
    return path.posix.join(parsed.dir, `${newName}.${ext}`);
  });
});

module.exports = router;
