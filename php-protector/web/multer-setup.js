const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');

// Configurable limits via environment variables
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10) * 1024 * 1024;
const MAX_TOTAL_SIZE = parseInt(process.env.MAX_TOTAL_SIZE_MB || '500', 10) * 1024 * 1024;
const MAX_FILES = parseInt(process.env.MAX_FILES || '5000', 10);
const CLEANUP_INTERVAL_MIN = parseInt(process.env.CLEANUP_INTERVAL_MIN || '15', 10);
const STALE_AGE_MIN = parseInt(process.env.STALE_AGE_MIN || '30', 10);

const uploadsDir = path.join(__dirname, '../uploads');
const tmpDir = path.join(__dirname, '../tmp');

// Ensure directories exist
[uploadsDir, tmpDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

/**
 * Middleware to enforce total upload size across all files.
 * Use after upload middleware: router.post('/path', upload.array('files'), enforceTotalSize, handler)
 */
function enforceTotalSize(req, res, next) {
  if (!req.files) return next();
  const total = req.files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_SIZE) {
    cleanupJob(req.jobId);
    return res.status(413).json({ error: `Total upload size exceeds ${MAX_TOTAL_SIZE / (1024 * 1024)}MB limit` });
  }
  next();
}

function cleanupJob(jobId) {
  const jobDir = path.join(uploadsDir, jobId);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/**
 * Sweep stale folders in both uploads/ and tmp/
 */
function sweepStaleFiles() {
  const now = Date.now();
  [uploadsDir, tmpDir].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir);
      entries.forEach(entry => {
        const fullPath = path.join(dir, entry);
        try {
          const stats = fs.statSync(fullPath);
          const ageMin = (now - stats.mtimeMs) / 60000;
          if (ageMin > STALE_AGE_MIN) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`[Sweeper] Cleaned: ${entry} (${ageMin.toFixed(0)}min old)`);
          }
        } catch (e) { console.warn(`[Sweeper] Could not process ${entry}:`, e.message); }
      });
    } catch (e) { console.warn(`[Sweeper] Could not read ${dir}:`, e.message); }
  });
}

// Run cleanup on configured interval
cron.schedule(`*/${CLEANUP_INTERVAL_MIN} * * * *`, sweepStaleFiles);

// Also run once on startup to clear any leftovers
sweepStaleFiles();

module.exports = { upload, cleanupJob, enforceTotalSize, MAX_FILE_SIZE, MAX_TOTAL_SIZE, MAX_FILES };
