const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { router: progressRouter } = require('./routes/progress');
const { TOOLS, publicTools } = require('./tool-registry');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = process.env.PORT ? 0 : 10;

// Serve versioned/static assets outside the API limiter.
app.use(express.static(path.join(__dirname, '../public')));

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
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false
}));

app.use(compression());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MINUTE) || 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' }
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

  res.status(status).render('error', {
    code: String(status),
    heading: status >= 500 ? 'Something went wrong' : 'Request failed',
    message: publicMessage
  });
});

function startServer(port, retriesLeft = MAX_PORT_RETRIES) {
  const server = app.listen(port, () => {
    console.log(`DevToolkit running at http://localhost:${port}`);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && retriesLeft > 0) {
      console.warn(`Port ${port} is in use, retrying on ${port + 1}`);
      startServer(port + 1, retriesLeft - 1);
      return;
    }
    console.error('Failed to start server:', error.message);
    process.exit(1);
  });
}

startServer(DEFAULT_PORT);
