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

router.post('/minify', upload.array('files'), enforceTotalSize, validateUploadedFiles, async (req, res) => {
  const { minifyHtml: doHtml, minifyCss: doCss, minifyJs: doJs, mangleVariables, preserveComments, renamePattern } = req.body;
  const files = req.files;
  const paths = req.safePaths;
  const jobId = files[0].destination.split('/').pop();

  const onEnd = () => cleanupJob(jobId);
  res.on('finish', onEnd);
  res.on('close', onEnd);

  const processFile = async (buffer, relativePath) => {
    const ext = path.extname(relativePath).toLowerCase();
    try {
      if ((ext === '.html' || ext === '.htm') && doHtml === 'true') {
        const minified = await minifyHtml(buffer.toString('utf8'), {
          collapseWhitespace: true,
          removeComments: preserveComments !== 'true',
          removeRedundantAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
          useShortDoctype: true,
          minifyJS: true,
          minifyCSS: true
        });
        return Buffer.from(minified, 'utf8');
      }
      if (ext === '.css' && doCss === 'true') {
        return Buffer.from(new CleanCSS({ level: 2 }).minify(buffer.toString('utf8')).styles, 'utf8');
      }
      if (ext === '.js' && doJs === 'true') {
        const minified = await minifyJs(buffer.toString('utf8'), {
          mangle: mangleVariables === 'true',
          compress: true,
          format: preserveComments === 'true' ? { comments: 'all' } : undefined
        });
        return Buffer.from(minified.code || buffer.toString('utf8'), 'utf8');
      }
    } catch (error) {
      console.error(`[Minification Error on ${relativePath}]`, error.message);
    }
    return buffer;
  };

  const renamer = (relativePath, index) => {
    if (!renamePattern) return relativePath;
    const parsed = path.posix.parse(relativePath);
    const customName = renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1);
    return safeRelativePath(path.posix.join(parsed.dir, customName + parsed.ext));
  };

  if (files.length === 1) {
    try {
      const relativePath = paths[0];
      const output = await processFile(await fs.promises.readFile(files[0].path), relativePath);
      const outName = path.basename(renamer(relativePath, 0));
      res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(output);
    } catch (err) {
      console.error('[Single Minify Error]', err);
      return res.status(500).send('Processing failed');
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="minified-codebase-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('[Archive Error]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
  });
  archive.pipe(res);

  try {
    const usedNames = new Set();
    for (let i = 0; i < files.length; i++) {
      const relativePath = paths[i];
      const output = await processFile(await fs.promises.readFile(files[i].path), relativePath);
      const candidate = safeRelativePath(renamer(relativePath, i));
      let uniquePath = candidate;
      let counter = 1;
      while (usedNames.has(uniquePath)) {
        const parsed = path.posix.parse(candidate);
        uniquePath = safeRelativePath(path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`));
        counter++;
      }
      usedNames.add(uniquePath);
      archive.append(output, { name: uniquePath });
    }
    archive.finalize();
  } catch (err) {
    console.error('[Bulk Minify Error]', err);
    try { archive.finalize(); } catch (_) {}
  }
});

module.exports = router;
