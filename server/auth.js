const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { sendEmail } = require('./email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'replyping-dev-secret');

// Middleware to verify JWT
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(id, email.toLowerCase(), hash, name || '');

    // Create default channels and rules
    const igChannel = uuidv4();
    const waChannel = uuidv4();
    db.prepare('INSERT INTO channels (id, user_id, type, name) VALUES (?, ?, ?, ?)').run(igChannel, id, 'instagram', 'My Instagram');
    db.prepare('INSERT INTO channels (id, user_id, type, name) VALUES (?, ?, ?, ?)').run(waChannel, id, 'whatsapp', 'My WhatsApp');
    db.prepare('INSERT INTO reminder_rules (id, user_id) VALUES (?, ?)').run(uuidv4(), id);

    const token = jwt.sign({ id, email: email.toLowerCase(), name: name || '' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, email: email.toLowerCase(), name: name || '' } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, name, plan, subscription_status, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const db = getDb();
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.toLowerCase());

    // Always return success to prevent email enumeration
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    db.prepare(`CREATE TABLE IF NOT EXISTS password_resets (
      email TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL
    )`).run();
    db.prepare('INSERT OR REPLACE INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)').run(user.email, token, expires);

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const resetLink = `${baseUrl}/#reset/${token}`;

    await sendEmail(user.email, 'Reset your ReplyPing password', `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#6c5ce7">ReplyPing Password Reset</h2>
        <p>Click the link below to reset your password. It expires in 1 hour.</p>
        <a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#6c5ce7;color:#fff;text-decoration:none;border-radius:8px;margin:16px 0">Reset Password</a>
        <p style="font-size:12px;color:#999">If you didn't request this, ignore this email.</p>
      </div>
    `);

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS password_resets (
      email TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL
    )`).run();

    const reset = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
    if (!reset || new Date(reset.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE email = ?').run(hash, reset.email);
    db.prepare('DELETE FROM password_resets WHERE email = ?').run(reset.email);

    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = { router, authenticate, JWT_SECRET };
