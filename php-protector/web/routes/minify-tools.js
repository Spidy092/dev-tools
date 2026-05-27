const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob } = require('../multer-setup');
const { minify: minifyHtml } = require('html-minifier-terser');
const CleanCSS = require('clean-css');
const { minify: minifyJs } = require('terser');

// POST /minify-tools/minify
router.post('/minify', upload.array('files'), async (req, res) => {
    // Note: formData passes booleans as strings "true" / "false"
    const { 
        minifyHtml: doHtml, 
        minifyCss: doCss, 
        minifyJs: doJs, 
        mangleVariables, 
        preserveComments, 
        renamePattern 
    } = req.body;
    
    const files = req.files;
    const paths = req.body.paths;
    const jobId = (files && files.length > 0) ? files[0].destination.split('/').pop() : null;

    if (!files || files.length === 0) return res.status(400).send('No files uploaded');

    const isSingle = files.length === 1;
    const normalizedPaths = Array.isArray(paths) ? paths : [paths];

    const onEnd = () => { if (jobId) cleanupJob(jobId); };
    res.on('finish', onEnd);
    res.on('close', onEnd);

    // Minifier wrapper
    const processFile = async (buffer, relativePath) => {
        const ext = path.extname(relativePath).toLowerCase();
        let content = buffer;

        try {
            if (ext === '.html' || ext === '.htm') {
                if (doHtml === 'true') {
                    const htmlContent = buffer.toString('utf8');
                    const minified = await minifyHtml(htmlContent, {
                        collapseWhitespace: true,
                        removeComments: preserveComments !== 'true',
                        removeRedundantAttributes: true,
                        removeScriptTypeAttributes: true,
                        removeStyleLinkTypeAttributes: true,
                        useShortDoctype: true,
                        minifyJS: true,
                        minifyCSS: true
                    });
                    content = Buffer.from(minified, 'utf8');
                }
            } 
            else if (ext === '.css') {
                if (doCss === 'true') {
                    const cssContent = buffer.toString('utf8');
                    const output = new CleanCSS({
                        level: 2 // Aggressive
                    }).minify(cssContent);
                    content = Buffer.from(output.styles, 'utf8');
                }
            }
            else if (ext === '.js') {
                if (doJs === 'true') {
                    const jsContent = buffer.toString('utf8');
                    let formatConfig = undefined;
                    if (preserveComments === 'true') {
                        formatConfig = { comments: 'all' };
                    }
                    const minified = await minifyJs(jsContent, {
                        mangle: mangleVariables === 'true',
                        compress: true,
                        format: formatConfig
                    });
                    if (minified.code) {
                         content = Buffer.from(minified.code, 'utf8');
                    }
                }
            }
        } catch (error) {
            console.error(`[Minification Error on ${relativePath}]:`, error);
            // On failure parsing a file, we silently fallback to original buffer to preserve integrity
        }

        return content;
    };

    const renamer = (relativePath, index) => {
        if (!renamePattern) return relativePath;
        const parsed = path.parse(relativePath);
        const customName = renamePattern.replace(/{name}/g, parsed.name).replace(/{index}/g, index + 1);
        return (parsed.dir ? parsed.dir + '/' : '') + customName + parsed.ext;
    };

    // Single File Mode
    if (isSingle) {
        try {
            const file = files[0];
            const relativePath = normalizedPaths[0] || file.originalname;
            const fileBuffer = await fs.promises.readFile(file.path);
            
            const processedBuffer = await processFile(fileBuffer, relativePath);
            let outName = renamer(relativePath, 0);
            outName = path.basename(outName); 
            
            res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            return res.send(processedBuffer);
        } catch (err) {
            console.error('[Single Process Error]', err);
            if (!res.headersSent) return res.status(500).send('Processing failed');
        }
    }

    // Bulk Mode
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="minified-codebase-${Date.now()}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
        console.error('[Archive Error]', err);
        if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
    });
    archive.pipe(res);

    try {
        const usedNames = new Set();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relativePath = normalizedPaths[i] || file.originalname;
            const fileBuffer = await fs.promises.readFile(file.path);

            const processedBuffer = await processFile(fileBuffer, relativePath);
            let finalPath = renamer(relativePath, i);
            
            // Collision resolution
            let uniquePath = finalPath;
            let counter = 1;
            while (usedNames.has(uniquePath)) {
                const parsedPath = path.parse(finalPath);
                uniquePath = (parsedPath.dir ? parsedPath.dir + '/' : '') + parsedPath.name + '-' + counter + parsedPath.ext;
                counter++;
            }
            usedNames.add(uniquePath);
            
            archive.append(processedBuffer, { name: uniquePath });
        }
        archive.finalize();
    } catch (err) {
        console.error('[Bulk Process Error]', err);
        archive.finalize(); 
    }
});

module.exports = router;
