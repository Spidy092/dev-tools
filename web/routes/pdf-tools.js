const express = require('express');
const router = express.Router();
const path = require('path');
const { pipeline } = require('stream/promises');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles } = require('../security');
const { compressPDF, PdfProcessingError } = require('../../core/pdfProcessor');
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

const PDF_LEVELS = new Set(['/screen', '/ebook', '/printer', '/prepress']);

function coreOptions(jobId) {
  return { signal: getJobSignal(jobId), checkCancelled: () => throwIfCancelled(jobId) };
}

function cancelled(error, jobId) {
  if (error instanceof JobCancelledError || error?.code === 'PROCESSING_ABORTED') return true;
  try { throwIfCancelled(jobId); } catch (err) { return err instanceof JobCancelledError; }
  return false;
}

function fallbackAllowed(error) {
  return error instanceof PdfProcessingError && ['PDF_GHOSTSCRIPT_FAILED', 'PDF_TIMEOUT'].includes(error.code);
}

router.post('/compress', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const requestedLevel = String(req.body.pdfLevel || '/screen');
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
  if (!PDF_LEVELS.has(requestedLevel)) {
    endProgress(jobId, 'failed');
    return res.status(400).json({ error: 'Unsupported PDF compression level.' });
  }

  try {
    const totalBytes = totalDeclaredBytes(files, RESOURCE_POLICY.coreBatchBytes);

    if (files.length === 1) {
      const file = files[0];
      const relativePath = paths[0];
      if (path.extname(relativePath).toLowerCase() !== '.pdf') {
        endProgress(jobId, 'failed');
        return res.status(415).json({ error: 'PDF Compressor accepts PDF files only.' });
      }

      const compressedPath = file.path + '-compressed.pdf';
      const result = await compressPDF(file.path, compressedPath, requestedLevel, {
        expectedSize: file.size,
        maxBytes: RESOURCE_POLICY.coreBatchBytes,
        ...coreOptions(jobId)
      });
      const source = createVerifiedReadStream(result.outputPath, {
        expectedSize: result.compressedSize,
        maxBytes: RESOURCE_POLICY.coreBatchBytes,
        ...coreOptions(jobId),
        onComplete: () => sendProgress(jobId, {
          event: 'file', file: relativePath, type: 'compress',
          originalSize: result.originalSize, compressedSize: result.compressedSize, reduction: result.reduction
        })
      });
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
      res.setHeader('Content-Type', 'application/pdf');
      await pipeline(source, res);
      return;
    }

    const entries = files.map((file, index) => {
      const relativePath = paths[index];
      const isPdf = path.extname(relativePath).toLowerCase() === '.pdf';
      if (!isPdf) {
        return {
          name: relativePath,
          filePath: file.path,
          size: file.size,
          sourcePath: relativePath,
          passthrough: true
        };
      }

      return {
        name: relativePath,
        size: file.size,
        sourcePath: relativePath,
        passthrough: false,
        open: async () => {
          const compressedPath = file.path + '-compressed.pdf';
          try {
            const result = await compressPDF(file.path, compressedPath, requestedLevel, {
              expectedSize: file.size,
              maxBytes: RESOURCE_POLICY.coreBatchBytes,
              ...coreOptions(jobId)
            });
            return createVerifiedReadStream(result.outputPath, {
              expectedSize: result.compressedSize,
              maxBytes: RESOURCE_POLICY.coreBatchBytes,
              ...coreOptions(jobId),
              onComplete: () => sendProgress(jobId, {
                event: 'file', file: relativePath, type: 'compress',
                originalSize: result.originalSize, compressedSize: result.compressedSize, reduction: result.reduction
              })
            });
          } catch (error) {
            if (cancelled(error, jobId) || !fallbackAllowed(error)) throw error;
            console.warn(`[PDF fallback] ${relativePath}: ${error.code}`);
            return createVerifiedReadStream(file.path, {
              expectedSize: file.size,
              maxBytes: RESOURCE_POLICY.coreBatchBytes,
              ...coreOptions(jobId),
              onComplete: ({ bytes }) => sendProgress(jobId, {
                event: 'file', file: relativePath, type: 'skip',
                originalSize: bytes, compressedSize: bytes, reduction: 0,
                reason: error.code
              })
            });
          }
        }
      };
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="compressed-pdfs-${Date.now()}.zip"`);
    await writeZip(res, entries, {
      level: 9,
      maxFileBytes: RESOURCE_POLICY.coreBatchBytes,
      maxTotalBytes: totalBytes,
      ...coreOptions(jobId),
      onEntryComplete: ({ entry, outputBytes }) => {
        if (!entry.passthrough) return;
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
    console.error('[PDF Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) {
      if (err?.code === 'CORE_BATCH_LIMIT' || err?.code === 'FILE_SIZE_LIMIT') return res.status(413).json({ error: 'The selected PDF batch exceeds the core resource budget.' });
      if (err?.code === 'PDF_SPAWN_FAILED') return res.status(503).json({ error: 'Ghostscript is unavailable on this DevToolkit instance.' });
      if (err?.code === 'PDF_TIMEOUT') return res.status(504).json({ error: 'PDF compression timed out.' });
      if (['NON_PORTABLE_ARCHIVE_PATH', 'PORTABLE_ARCHIVE_COLLISION', 'ARCHIVE_PATH_TOO_LONG'].includes(err?.code)) return res.status(400).json({ error: err.message });
      return res.status(500).json({ error: 'PDF compression failed.' });
    }
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
