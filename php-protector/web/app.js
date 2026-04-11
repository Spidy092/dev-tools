const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = process.env.PORT ? 0 : 10;

// 🔥 Security and Performance Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Let our inline scripts like toolEndpoint keep working
}));
app.use(compression());

// 🔥 Rate limiting: Max 30 tools per 1 minute window (prevent DoS)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many requests from this IP, please try again in a minute.'
});
app.use(limiter);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Serve static files from /public
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => res.render('index'));
app.get('/php-protector', (req, res) => res.render('php-protector'));
app.get('/image-resizer', (req, res) => res.render('image-resizer'));
app.get('/image-converter', (req, res) => res.render('image-converter'));
app.get('/pdf-compressor', (req, res) => res.render('pdf-compressor'));

// API Routes
app.use('/', require('./routes/php-tools'));
app.use('/image-tools', require('./routes/image-tools'));
app.use('/pdf-tools', require('./routes/pdf-tools'));

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
