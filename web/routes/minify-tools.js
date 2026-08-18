const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob, enforceTotalSize } = require('../multer-setup');
const { validateUploadedFiles, safeRelativePath } = require('../security');
const { minify: minifyHtml } = require('html-minifier-terser');
const CleanCSS = require('clean-css');
const { minify: minifyJs } = require('terser');
const { prepareJob, sendProgress, endProgress, throwIfCancelled, JobCancelledError } = require('./progress');

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

  const processFile = async (buffer, relativePath) => {
    throwIfCancelled(jobId);
    const ext = path.extname(relativePath).toLowerCase();
    try {
      let output = buffer;
      if ((ext === '.html' || ext === '.htm') && doHtml === 'true') {
        output = Buffer.from(await minifyHtml(buffer.toString('utf8'), {
          collapseWhitespace: true,
          removeComments: preserveComments !== 'true',
          removeRedundantAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
          useShortDoctype: true,
          minifyJS: true,
          minifyCSS: true
        }), 'utf8');
      } else if (ext === '.css' && doCss === 'true') {
        output = Buffer.from(new CleanCSS({ level: 2 }).minify(buffer.toString('utf8')).styles, 'utf8');
      } else if (ext === '.js' && doJs === 'true') {
        const minified = await minifyJs(buffer.toString('utf8'), {
          mangle: mangleVariables === 'true',
          compress: true,
          format: preserveComments === 'true' ? { comments: 'all' } : undefined
        });
        output = Buffer.from(minified.code || buffer.toString('utf8'), 'utf8');
      }
      throwIfCancelled(jobId);
      return output;
    } catch (error) {
      if (error instanceof JobCancelledError) throw error;
      console.error(`[Minification Error on ${relativePath}]`, error.message);
      return buffer;
    }
  };

  const renamer = (relativePath, index) => {
    if (!renamePattern) return relativePath;
    const parsed = path.posix.parse(relativePath);
    const customName = renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1);
    return safeRelativePath(path.posix.join(parsed.dir, customName + parsed.ext));
  };

  const runOne = async (file, relativePath, index) => {
    const input = await fs.promises.readFile(file.path);
    const output = await processFile(input, relativePath);
    sendProgress(jobId, { event: 'file', file: relativePath, type: 'process', originalSize: input.length, compressedSize: output.length });
    return { output, name: renamer(relativePath, index) };
  };

  if (files.length === 1) {
    try {
      const result = await runOne(files[0], paths[0], 0);
      endProgress(jobId, 'completed');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(result.name)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(result.output);
    } catch (err) {
      if (err instanceof JobCancelledError) {
        endProgress(jobId, 'cancelled');
        return res.status(499).json({ error: err.message });
      }
      console.error('[Single Minify Error]', err);
      endProgress(jobId, 'failed');
      return res.status(500).send('Processing failed');
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="minified-codebase-${Date.now()}.zip"`);
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
      const result = await runOne(files[i], paths[i], i);
      const candidate = safeRelativePath(result.name);
      let uniquePath = candidate;
      let counter = 1;
      while (usedNames.has(uniquePath)) {
        const parsed = path.posix.parse(candidate);
        uniquePath = safeRelativePath(path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`));
        counter++;
      }
      usedNames.add(uniquePath);
      archive.append(result.output, { name: uniquePath });
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
    console.error('[Bulk Minify Error]', err);
    endProgress(jobId, 'failed');
    try { archive.abort(); } catch (_) {}
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
