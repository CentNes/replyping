const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, seedDemoUser } = require('./database');
const { router: authRouter, authenticate } = require('./auth');
const todosRouter = require('./todos');
const rulesRouter = require('./rules');
const webhooksRouter = require('./webhooks');
const { router: notificationsRouter } = require('./notifications');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/todos', todosRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/notifications', notificationsRouter);

// Webhook Routes (no auth required - these are called by Instagram/WhatsApp)
app.use('/webhooks', webhooksRouter);

// Dev simulate route (no auth for easy testing)
app.use('/api/dev', webhooksRouter);

// SPA fallback - serve index.html for all non-API routes
app.get('/{*splat}', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/webhooks')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

// Initialize and start
initDatabase();
seedDemoUser();
startScheduler();

app.listen(PORT, () => {
  console.log(`\n  ReplyPing server running at http://localhost:${PORT}`);
  console.log(`  Demo login: demo@replyping.com / demo123\n`);
});
