const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { upload, cleanupJob } = require('../multer-setup');

// POST /file-tools/rename
router.post('/rename', upload.array('files'), async (req, res) => {
    const { casing, separator, strictClean, collapseHyphens, organizeByExtension, renamePattern } = req.body;
    const files = req.files;
    const paths = req.body.paths;
    const jobId = (files && files.length > 0) ? files[0].destination.split('/').pop() : null;

    if (!files || files.length === 0) return res.status(400).send('No files uploaded');

    const isSingle = files.length === 1;
    const normalizedPaths = Array.isArray(paths) ? paths : [paths];

    const onEnd = () => { if (jobId) cleanupJob(jobId); };
    res.on('finish', onEnd);
    res.on('close', onEnd);

    // Python-style clean function
    const sanitizeName = (name) => {
        let base = name;

        // Casing
        if (casing === 'lowercase') base = base.toLowerCase();
        else if (casing === 'uppercase') base = base.toUpperCase();

        // Separator logic
        const sepChar = separator === 'hyphen' ? '-' : (separator === 'underscore' ? '_' : (separator === 'none' ? '' : null));
        if (sepChar !== null) {
            base = base.replace(/[\.\s]/g, sepChar);
        }

        // Strict clean: Keep only alphanumeric and the chosen separator
        if (strictClean === 'true') {
            if (sepChar === '-') {
                base = base.replace(/[^a-zA-Z0-9\-]/g, '');
            } else if (sepChar === '_') {
                base = base.replace(/[^a-zA-Z0-9_]/g, '');
            } else {
                base = base.replace(/[^a-zA-Z0-9]/g, '');
            }
        }

        // Collapse
        if (collapseHyphens === 'true') {
            if (sepChar === '-') base = base.replace(/\-+/g, '-');
            if (sepChar === '_') base = base.replace(/_+/g, '_');
        }

        return base;
    };

    // Quick heuristic to see if user had nested dirs
    const currentModeIsProbablyNotRecursive = normalizedPaths.every(p => p.indexOf('/') === -1);

    const renamer = (relativePath, index) => {
        let parsed = path.parse(relativePath);
        let nameToUse = parsed.name; // Keep as original by default

        // First apply standard pattern if provided
        if (renamePattern) {
            nameToUse = renamePattern.replace(/{name}/g, nameToUse).replace(/{index}/g, index + 1);
        }

        // Then apply strict sanitizations
        let newName = sanitizeName(nameToUse);
        
        // Extension preservation (lowercase explicitly like Python unless uppercase)
        let ext = parsed.ext;
        if (casing === 'lowercase') ext = ext.toLowerCase();
        else if (casing === 'uppercase') ext = ext.toUpperCase();

        let finalPath = (parsed.dir ? parsed.dir + '/' : '') + newName + ext;

        // Dynamic organizing by extension
        if (organizeByExtension === 'true') {
            const extName = ext.replace('.', '').toUpperCase();
            const folderName = extName ? `${extName}_Files` : 'Other_Files';
            
            // If they drop a single flat list, just prefix folderName.
            // But if they have nested dirs, it gets complicated. We will just prepend the extension folder.
            if (currentModeIsProbablyNotRecursive) {
                // Actually, let's just make folder the root
                finalPath = `${folderName}/` + newName + ext;
            } else {
                 finalPath = `${folderName}/` + finalPath;
            }
        }

        return finalPath;
    };
    
    if (isSingle) {
        try {
            const file = files[0];
            const relativePath = normalizedPaths[0] || file.originalname;
            const fileBuffer = await fs.promises.readFile(file.path);
            let outName = renamer(relativePath, 0);

            // Removing directory parts just in case organizeByExtension added it for single 
            outName = path.basename(outName); 
            
            res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            return res.send(fileBuffer);
        } catch (err) {
            console.error('[Single Process Error]', err);
            return res.status(500).send('Processing failed');
        }
    }

    // Bulk Mode -> ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="renamed-${Date.now()}.zip"`);
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
            let relativePath = normalizedPaths[i] || file.originalname;
            const fileBuffer = await fs.promises.readFile(file.path);

            // In bulk, if organizeByExtension is on, we flatten original dirs if required.
            if (organizeByExtension === 'true') {
                // Ignore original subdirectories inside the extension folder
                 relativePath = path.basename(relativePath);
            }

            let finalPath = renamer(relativePath, i);
            
            let uniquePath = finalPath;
            let counter = 1;
            while (usedNames.has(uniquePath)) {
                const parsedPath = path.parse(finalPath);
                uniquePath = (parsedPath.dir ? parsedPath.dir + '/' : '') + parsedPath.name + '-' + counter + parsedPath.ext;
                counter++;
            }
            usedNames.add(uniquePath);
            
            archive.append(fileBuffer, { name: uniquePath });
        }
        archive.finalize();
    } catch (err) {
        console.error('[Bulk Process Error]', err);
        archive.finalize(); 
    }
});

module.exports = router;
