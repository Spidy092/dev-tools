const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { router: progressRouter } = require('./routes/progress');

const crypto = require('crypto');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = process.env.PORT ? 0 : 10;

// Generate per-request nonce for CSP
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(compression());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many requests from this IP, please try again in a minute.'
});
app.use(limiter);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Page routes
app.get('/', (req, res) => res.render('index'));
app.get('/settings', (req, res) => res.render('settings'));
app.get('/php-protector', (req, res) => res.render('php-protector'));
app.get('/image-resizer', (req, res) => res.render('image-resizer'));
app.get('/image-converter', (req, res) => res.render('image-converter'));
app.get('/pdf-compressor', (req, res) => res.render('pdf-compressor'));
app.get('/file-renamer', (req, res) => res.render('file-renamer'));
app.get('/code-minifier', (req, res) => res.render('code-minifier'));

// SSE progress endpoint
app.use('/progress', progressRouter);

// API Routes
app.use('/', require('./routes/php-tools'));
app.use('/image-tools', require('./routes/image-tools'));
app.use('/pdf-tools', require('./routes/pdf-tools'));
app.use('/file-tools', require('./routes/file-tools'));
app.use('/minify-tools', require('./routes/minify-tools'));

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { code: '404', heading: 'Page not found', message: "The page you're looking for doesn't exist or has been moved." });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error(err.stack || err.message);
  res.status(err.status || 500).render('error', { code: String(err.status || 500), heading: 'Something went wrong', message: err.message || 'An unexpected error occurred. Please try again.' });
});

function startServer(port, retriesLeft = MAX_PORT_RETRIES) {
  const server = app.listen(port, () => {
    console.log(`Developer Tools running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
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
