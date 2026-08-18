const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { router: progressRouter, getJobCounts, cancelAllActiveJobs, closeProgressClients } = require('./routes/progress');
const { preflightAdmission, getAdmissionSnapshot, shutdownAdmission } = require('./admission');
const { TOOLS, publicTools } = require('./tool-registry');
const { uploadsDir, tmpDir, MAX_TOTAL_SIZE } = require('./multer-setup');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === 'false' ? false : (process.env.TRUST_PROXY || 1);
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = process.env.PORT ? 0 : 10;
const SHUTDOWN_GRACE_MS = Math.max(1_000, Number(process.env.SHUTDOWN_GRACE_MS) || 15_000);
const MAX_CONTENT_LENGTH = Math.max(1, Number(process.env.MAX_REQUEST_SIZE_MB) || Math.ceil(MAX_TOTAL_SIZE / (1024 * 1024) + 5)) * 1024 * 1024;

let shuttingDown = false;
let startedAt = Date.now();

app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);

function isWritableDirectory(dir) {
  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function readiness() {
  const directoriesReady = isWritableDirectory(uploadsDir) && isWritableDirectory(tmpDir);
  const memory = process.memoryUsage();
  const heapLimitMb = Math.max(128, Number(process.env.READINESS_MAX_HEAP_MB) || 1800);
  const memoryReady = memory.heapUsed < heapLimitMb * 1024 * 1024;
  const admission = getAdmissionSnapshot();
  const capacityReady = admission.accepting;
  return {
    ready: !shuttingDown && directoriesReady && memoryReady && capacityReady,
    checks: {
      shuttingDown,
      tempDirectoriesWritable: directoriesReady,
      heapWithinLimit: memoryReady,
      processingCapacityAvailable: capacityReady
    },
    memory: {
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      rssMb: Math.round(memory.rss / 1024 / 1024)
    },
    jobs: getJobCounts(),
    admission
  };
}

app.get('/healthz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    pid: process.pid
  });
});

app.get('/readyz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const state = readiness();
  res.status(state.ready ? 200 : 503).json(state);
});

// Reject obviously oversized requests before Multer writes them to disk. This is a
// second line of defense; production deployments should still enforce a stricter
// request-body limit at the reverse proxy/load balancer.
app.use((req, res, next) => {
  if (shuttingDown && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ error: 'Server is restarting. Please retry shortly.' });
  }
  const length = Number(req.get('content-length'));
  if (Number.isFinite(length) && length > MAX_CONTENT_LENGTH) {
    return res.status(413).json({ error: `Request body exceeds the ${Math.floor(MAX_CONTENT_LENGTH / (1024 * 1024))}MB server limit.` });
  }
  next();
});

// If the processing queue is already at its hard ceiling, reject known processor
// POSTs before Multer writes another upload to temporary disk. The post-upload
// gate still performs the authoritative weighted admission decision.
app.use(preflightAdmission());

// Serve versioned/static assets outside the API limiter.
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: isProduction ? '1h' : 0,
  etag: true,
  immutable: false
}));

// Generate a per-request nonce for CSP-protected inline bootstrap scripts.
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  res.locals.tools = publicTools();
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    return compression.filter(req, res);
  }
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MINUTE) || 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
  skip: req => req.path === '/healthz' || req.path === '/readyz'
});
app.use(limiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Product routes are generated from the central tool registry.
app.get('/', (req, res) => res.render('index', { tools: publicTools() }));
app.get('/settings', (req, res) => res.render('settings'));
for (const tool of TOOLS) {
  app.get(tool.route, (req, res) => res.render(tool.view, { tool }));
}

// Lightweight registry endpoint for search/navigation clients.
app.get('/api/tools', (req, res) => res.json({ tools: publicTools() }));

app.use('/progress', progressRouter);

// API routes
app.use('/', require('./routes/php-tools'));
app.use('/image-tools', require('./routes/image-tools'));
app.use('/image-compressor-tools', require('./routes/image-compressor-tools'));
app.use('/pdf-tools', require('./routes/pdf-tools'));
app.use('/file-tools', require('./routes/file-tools'));
app.use('/minify-tools', require('./routes/minify-tools'));

app.use((req, res) => {
  res.status(404).render('error', {
    code: '404',
    heading: 'Page not found',
    message: "The page you're looking for doesn't exist or has moved."
  });
});

app.use((err, req, res, _next) => {
  const errorId = crypto.randomBytes(6).toString('hex');
  console.error(`[${errorId}]`, err.stack || err.message || err);

  const status = Number(err.status) || 500;
  const publicMessage = isProduction && status >= 500
    ? `An unexpected error occurred. Reference: ${errorId}`
    : (err.message || 'An unexpected error occurred.');

  if (req.accepts('html')) {
    return res.status(status).render('error', {
      code: String(status),
      heading: status >= 500 ? 'Something went wrong' : 'Request failed',
      message: publicMessage
    });
  }
  res.status(status).json({ error: publicMessage, reference: status >= 500 ? errorId : undefined });
});

function startServer(port, retriesLeft = MAX_PORT_RETRIES) {
  const server = app.listen(port, () => {
    startedAt = Date.now();
    console.log(`DevToolkit running at http://localhost:${port}`);
  });

  server.keepAliveTimeout = Math.max(5_000, Number(process.env.KEEP_ALIVE_TIMEOUT_MS) || 65_000);
  server.headersTimeout = Math.max(server.keepAliveTimeout + 1_000, Number(process.env.HEADERS_TIMEOUT_MS) || 70_000);
  server.requestTimeout = Math.max(10_000, Number(process.env.REQUEST_TIMEOUT_MS) || 6 * 60 * 1000);

  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && retriesLeft > 0) {
      console.warn(`Port ${port} is in use, retrying on ${port + 1}`);
      startServer(port + 1, retriesLeft - 1);
      return;
    }
    console.error('Failed to start server:', error.message);
    process.exitCode = 1;
  });

  let shutdownStarted = false;
  function shutdown(signal) {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shuttingDown = true;
    const queuedClosed = shutdownAdmission(signal);
    const counts = getJobCounts();
    console.log(`[Shutdown] ${signal} received. Active jobs: ${counts.active}; queued admissions closed: ${queuedClosed}`);

    server.close(() => {
      closeProgressClients();
      console.log('[Shutdown] HTTP server closed cleanly.');
      process.exit(0);
    });

    setTimeout(() => {
      const cancelled = cancelAllActiveJobs('shutdown');
      closeProgressClients();
      console.warn(`[Shutdown] Grace period expired; requested cancellation for ${cancelled} active job(s).`);
      server.closeAllConnections?.();
      process.exit(0);
    }, SHUTDOWN_GRACE_MS).unref();
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer(DEFAULT_PORT);
}

module.exports = { app, startServer, readiness };
