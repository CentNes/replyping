const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { authenticate } = require('./auth');
const { sendEmail } = require('./email');

const router = express.Router();

// Create notification and send email
async function createNotification(userId, todoId, type, title, message) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`INSERT INTO notifications (id, user_id, todo_id, type, channel, title, message)
    VALUES (?, ?, ?, ?, 'both', ?, ?)`)
    .run(id, userId, todoId, type, title, message);

  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (user) {
    const isEscalation = type === 'escalation';
    const sent = await sendEmail(user.email, `[ReplyPing] ${title}`, `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:${isEscalation ? '#d63031' : '#6c5ce7'}">${title}</h2>
        <p>${message}</p>
        <p style="font-size:12px;color:#999">— ReplyPing</p>
      </div>
    `);
    if (sent) db.prepare('UPDATE notifications SET email_sent = 1 WHERE id = ?').run(id);
  }

  return id;
}

// GET /api/notifications
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    const notifications = db.prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.user.id);
    const unreadCount = db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0'
    ).get(req.user.id);
    res.json({ notifications, unread_count: unreadCount.count });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

module.exports = { router, createNotification };
