const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');

const MAX_FILE_SIZE = Math.max(1, parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10)) * 1024 * 1024;
const MAX_TOTAL_SIZE = Math.max(1, parseInt(process.env.MAX_TOTAL_SIZE_MB || '500', 10)) * 1024 * 1024;
const MAX_FILES = Math.min(10000, Math.max(1, parseInt(process.env.MAX_FILES || '5000', 10)));
const CLEANUP_INTERVAL_MIN = Math.min(59, Math.max(1, parseInt(process.env.CLEANUP_INTERVAL_MIN || '15', 10)));
const STALE_AGE_MIN = Math.max(5, parseInt(process.env.STALE_AGE_MIN || '30', 10));

const uploadsDir = path.join(__dirname, '../uploads');
const tmpDir = path.join(__dirname, '../tmp');

[uploadsDir, tmpDir].forEach(dir => fs.mkdirSync(dir, { recursive: true, mode: 0o700 }));

function safeDiskName(originalName) {
  const base = path.basename(String(originalName || 'file'))
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._()\- ]/g, '_')
    .slice(-180) || 'file';
  return `${crypto.randomBytes(6).toString('hex')}-${base}`;
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    if (!req.jobId) req.jobId = crypto.randomBytes(8).toString('hex');
    const jobDir = path.join(uploadsDir, req.jobId);
    fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });
    cb(null, jobDir);
  },
  filename: (_req, file, cb) => cb(null, safeDiskName(file.originalname))
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: Math.max(MAX_FILES + 100, 500),
    fieldSize: 128 * 1024,
    parts: MAX_FILES * 2 + 200
  }
});

function enforceTotalSize(req, res, next) {
  if (!req.files) return next();
  const total = req.files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (total > MAX_TOTAL_SIZE) {
    cleanupJob(req.jobId);
    return res.status(413).json({ error: `Total upload size exceeds ${MAX_TOTAL_SIZE / (1024 * 1024)}MB limit` });
  }
  req.totalUploadBytes = total;
  next();
}

function cleanupJob(jobId) {
  if (!/^[a-f0-9]{16}$/.test(String(jobId || ''))) return;
  const jobDir = path.join(uploadsDir, jobId);
  if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
}

function sweepStaleFiles() {
  const now = Date.now();
  [uploadsDir, tmpDir].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    try {
      fs.readdirSync(dir).forEach(entry => {
        const fullPath = path.join(dir, entry);
        try {
          const stats = fs.statSync(fullPath);
          const ageMin = (now - stats.mtimeMs) / 60000;
          if (ageMin > STALE_AGE_MIN) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`[Sweeper] Cleaned ${entry} (${ageMin.toFixed(0)}m old)`);
          }
        } catch (error) {
          console.warn(`[Sweeper] Could not process ${entry}:`, error.message);
        }
      });
    } catch (error) {
      console.warn(`[Sweeper] Could not read ${dir}:`, error.message);
    }
  });
}

cron.schedule(`*/${CLEANUP_INTERVAL_MIN} * * * *`, sweepStaleFiles);
sweepStaleFiles();

module.exports = {
  upload,
  cleanupJob,
  enforceTotalSize,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_FILES,
  uploadsDir,
  tmpDir
};
