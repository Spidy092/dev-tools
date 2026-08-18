const express = require('express');
const router = express.Router();
const path = require('path');
const { pipeline } = require('stream/promises');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { minify: minifyHtml } = require('html-minifier-terser');
const CleanCSS = require('clean-css');
const { minify: minifyJs } = require('terser');
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

function coreOptions(jobId) {
  return { signal: getJobSignal(jobId), checkCancelled: () => throwIfCancelled(jobId) };
}

function cancelled(error, jobId) {
  if (error instanceof JobCancelledError || error?.code === 'PROCESSING_ABORTED') return true;
  try { throwIfCancelled(jobId); } catch (err) { return err instanceof JobCancelledError; }
  return false;
}

router.post('/minify', prepareJob, upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const { minifyHtml: doHtml, minifyCss: doCss, minifyJs: doJs, mangleVariables, preserveComments, renamePattern } = req.body;
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

  const shouldMinify = relativePath => {
    const ext = path.extname(relativePath).toLowerCase();
    return ((ext === '.html' || ext === '.htm') && doHtml === 'true') ||
      (ext === '.css' && doCss === 'true') ||
      (ext === '.js' && doJs === 'true');
  };

  const processBuffer = async (buffer, relativePath) => {
    throwIfCancelled(jobId);
    const ext = path.extname(relativePath).toLowerCase();
    try {
      if ((ext === '.html' || ext === '.htm') && doHtml === 'true') {
        return Buffer.from(await minifyHtml(buffer.toString('utf8'), {
          collapseWhitespace: true,
          removeComments: preserveComments !== 'true',
          removeRedundantAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
          useShortDoctype: true,
          minifyJS: true,
          minifyCSS: true
        }), 'utf8');
      }
      if (ext === '.css' && doCss === 'true') {
        const result = new CleanCSS({ level: 2 }).minify(buffer.toString('utf8'));
        if (result.errors?.length) throw new Error(result.errors.join('; '));
        return Buffer.from(result.styles, 'utf8');
      }
      if (ext === '.js' && doJs === 'true') {
        const source = buffer.toString('utf8');
        const minified = await minifyJs(source, {
          mangle: mangleVariables === 'true',
          compress: true,
          format: preserveComments === 'true' ? { comments: 'all' } : undefined
        });
        if (!minified || typeof minified.code !== 'string') throw new Error('JavaScript minifier returned no output.');
        return Buffer.from(minified.code, 'utf8');
      }
      return buffer;
    } finally {
      throwIfCancelled(jobId);
    }
  };

  const renamer = (relativePath, index) => {
    if (!renamePattern) return safeRelativePath(relativePath);
    const parsed = path.posix.parse(relativePath);
    const customName = renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1);
    return safeRelativePath(path.posix.join(parsed.dir, customName + parsed.ext));
  };

  const processOne = async (file, relativePath) => {
    const read = await readFileBuffer(file.path, {
      expectedSize: file.size,
      maxBytes: RESOURCE_POLICY.codeBufferBytes,
      ...coreOptions(jobId)
    });
    const output = await processBuffer(read.buffer, relativePath);
    sendProgress(jobId, {
      event: 'file', file: relativePath, type: 'process',
      originalSize: read.bytes, compressedSize: output.length
    });
    return output;
  };

  try {
    const totalBytes = totalDeclaredBytes(files, RESOURCE_POLICY.coreBatchBytes);

    if (files.length === 1) {
      const relativePath = paths[0];
      const outName = renamer(relativePath, 0);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(outName)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');

      if (!shouldMinify(relativePath)) {
        const source = createVerifiedReadStream(files[0].path, {
          expectedSize: files[0].size,
          ...coreOptions(jobId),
          onComplete: ({ bytes }) => sendProgress(jobId, {
            event: 'file', file: relativePath, type: 'skip', originalSize: bytes, compressedSize: bytes
          })
        });
        await pipeline(source, res);
        return;
      }

      const output = await processOne(files[0], relativePath);
      endProgress(jobId, 'completed');
      return res.send(output);
    }

    const usedNames = new Set();
    const entries = files.map((file, index) => {
      const relativePath = paths[index];
      const candidate = renamer(relativePath, index);
      let finalPath = candidate;
      let counter = 1;
      while (usedNames.has(finalPath.toLocaleLowerCase('en-US'))) {
        const parsed = path.posix.parse(candidate);
        finalPath = safeRelativePath(path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`));
        counter++;
      }
      usedNames.add(finalPath.toLocaleLowerCase('en-US'));

      if (!shouldMinify(relativePath)) {
        return { name: finalPath, filePath: file.path, size: file.size, sourcePath: relativePath, transformed: false };
      }
      return {
        name: finalPath,
        size: file.size,
        sourcePath: relativePath,
        transformed: true,
        open: async () => processOne(file, relativePath)
      };
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="minified-codebase-${Date.now()}.zip"`);
    await writeZip(res, entries, {
      level: 9,
      maxBufferBytes: RESOURCE_POLICY.codeBufferBytes,
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
    console.error('[Minify Error]', err);
    endProgress(jobId, 'failed');
    if (!res.headersSent) {
      if (err?.code === 'FILE_SIZE_LIMIT') return res.status(413).json({ error: 'A source file exceeds the configured code-processing memory budget.' });
      if (err?.code === 'CORE_BATCH_LIMIT') return res.status(413).json({ error: 'The selected project exceeds the core batch resource budget.' });
      if (['NON_PORTABLE_ARCHIVE_PATH', 'PORTABLE_ARCHIVE_COLLISION', 'ARCHIVE_PATH_TOO_LONG'].includes(err?.code)) return res.status(400).json({ error: err.message });
      return res.status(500).json({ error: 'Code minification failed.' });
    }
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
