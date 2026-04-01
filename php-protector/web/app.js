const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Developer Tools running at http://localhost:${PORT}`);
});
