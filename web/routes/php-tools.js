const express = require('express');
const router = express.Router();
const path = require('path');
const { pipeline } = require('stream/promises');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles } = require('../security');
const { obfuscateFile, PhpSourceError } = require('../../core/obfuscator');
const { createVerifiedReadStream } = require('../../core/processingEngine');
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

function coreOptions(jobId) {
  return {
    signal: getJobSignal(jobId),
    checkCancelled: () => throwIfCancelled(jobId)
  };
}

function cancelled(error, jobId) {
  if (error instanceof JobCancelledError || error?.code === 'PROCESSING_ABORTED') return true;
  try { throwIfCancelled(jobId); } catch (err) { return err instanceof JobCancelledError; }
  return false;
}

router.post('/upload', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
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

  try {
    const totalBytes = totalDeclaredBytes(files, RESOURCE_POLICY.coreBatchBytes);

    if (files.length === 1) {
      const file = files[0];
      const relativePath = paths[0];
      const ext = path.extname(relativePath).toLowerCase();
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);

      if (ext === '.php') {
        const result = await obfuscateFile(file.path, {
          expectedSize: file.size,
          maxBytes: RESOURCE_POLICY.codeBufferBytes,
          ...coreOptions(jobId)
        });
        sendProgress(jobId, {
          event: 'file', file: relativePath, type: 'php',
          originalSize: result.inputBytes, compressedSize: result.buffer.length
        });
        endProgress(jobId, 'completed');
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.send(result.buffer);
      }

      const source = createVerifiedReadStream(file.path, {
        expectedSize: file.size,
        ...coreOptions(jobId),
        onComplete: ({ bytes }) => sendProgress(jobId, {
          event: 'file', file: relativePath, type: 'copy', originalSize: bytes, compressedSize: bytes
        })
      });
      res.setHeader('Content-Type', 'application/octet-stream');
      await pipeline(source, res);
      return;
    }

    const entries = files.map((file, index) => {
      const relativePath = paths[index];
      const ext = path.extname(relativePath).toLowerCase();
      if (ext === '.php') {
        return {
          name: relativePath,
          size: file.size,
          sourcePath: relativePath,
          transformed: true,
          open: async () => {
            const result = await obfuscateFile(file.path, {
              expectedSize: file.size,
              maxBytes: RESOURCE_POLICY.codeBufferBytes,
              ...coreOptions(jobId)
            });
            sendProgress(jobId, {
              event: 'file', file: relativePath, type: 'php',
              originalSize: result.inputBytes, compressedSize: result.buffer.length
            });
            return result.buffer;
          }
        };
      }
      return {
        name: relativePath,
        filePath: file.path,
        size: file.size,
        sourcePath: relativePath,
        transformed: false
      };
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="protected.zip"');
    await writeZip(res, entries, {
      level: 9,
      maxBufferBytes: RESOURCE_POLICY.codeBufferBytes,
      maxTotalBytes: totalBytes,
      ...coreOptions(jobId),
      onEntryComplete: ({ entry, outputBytes }) => {
        if (entry.transformed) return;
        sendProgress(jobId, {
          event: 'file', file: entry.sourcePath, type: 'copy',
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
    console.error('[PHP Protector Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) {
      if (err instanceof PhpSourceError) return res.status(422).json({ error: err.message, code: err.code });
      if (err?.code === 'FILE_SIZE_LIMIT') return res.status(413).json({ error: 'A PHP source file exceeds the configured code-processing memory budget.' });
      if (err?.code === 'CORE_BATCH_LIMIT') return res.status(413).json({ error: 'The selected project exceeds the core batch resource budget.' });
      if (['NON_PORTABLE_ARCHIVE_PATH', 'PORTABLE_ARCHIVE_COLLISION', 'ARCHIVE_PATH_TOO_LONG'].includes(err?.code)) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Obfuscation failed.' });
    }
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
