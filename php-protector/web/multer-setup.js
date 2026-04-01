const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');

// Ensure root uploads folder exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Dynamic storage to put each request in its own folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!req.jobId) req.jobId = crypto.randomBytes(8).toString('hex');
        const jobDir = path.join(uploadsDir, req.jobId);
        if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);
        cb(null, jobDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = crypto.randomBytes(4).toString('hex') + '-' + path.basename(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB per individual file
});

/**
 * Utility to delete a folder recursively
 */
function cleanupJob(jobId) {
    const jobDir = path.join(uploadsDir, jobId);
    if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        console.log(`[Cleanup] Deleted job folder: ${jobId}`);
    }
}

/**
 * Background Sweeper: Clean up stale folders older than 30 minutes every 30 min
 */
cron.schedule('*/30 * * * *', () => {
    if (!fs.existsSync(uploadsDir)) return;
    const now = Date.now();
    const files = fs.readdirSync(uploadsDir);
    files.forEach(file => {
        const fullPath = path.join(uploadsDir, file);
        const stats = fs.statSync(fullPath);
        const ageInMin = (now - stats.mtimeMs) / 1000 / 60;
        if (ageInMin > 30) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`[Sweeper] Deleted stale folder: ${file} (${ageInMin.toFixed(1)} min)`);
        }
    });
});

module.exports = { upload, cleanupJob };
