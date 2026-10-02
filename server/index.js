require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDatabase, getDb, seedDemoUser } = require('./database');
const { router: authRouter, authenticate } = require('./auth');
const todosRouter = require('./todos');
const rulesRouter = require('./rules');
const webhooksRouter = require('./webhooks');
const { router: notificationsRouter } = require('./notifications');
const { startScheduler } = require('./scheduler');
const { router: billingRouter } = require('./billing');
const stripeWebhookRouter = require('./stripe-webhook');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) app.set('trust proxy', 1);

if (isProd && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Stripe webhook needs raw body BEFORE json middleware
app.use('/webhooks/stripe', stripeWebhookRouter);

// Middleware
app.use(cors(isProd ? { origin: process.env.CORS_ORIGIN } : {}));
app.use(express.json({ limit: '1mb' }));

// Rate limit auth routes
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: 'index.html' }));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/todos', todosRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/billing', billingRouter);

// Webhook Routes (no auth required - called by Instagram/WhatsApp)
app.use('/webhooks', webhooksRouter);

// Dev simulate route (disabled in production)
if (!isProd) {
  app.use('/api/dev', webhooksRouter);
}

// SPA fallback
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/webhooks')) {
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  next();
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start
initDatabase();
if (!isProd) seedDemoUser();
startScheduler();

const server = app.listen(PORT, () => {
  console.log(`\n  ReplyPing running at http://localhost:${PORT} [${isProd ? 'production' : 'development'}]`);
  if (!isProd) console.log(`  Demo login: demo@replyping.com / demo123\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    try { getDb().close(); } catch (_) {}
    process.exit(0);
  });
});
