const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { authenticate } = require('./auth');
const { sendMessage, isChannelConfigured } = require('./meta-api');

const router = express.Router();

// GET /api/todos?status=unreplied|snoozed|done
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { status } = req.query;

    // Un-snooze any snoozed todos whose snooze time has passed
    db.prepare(`
      UPDATE todos SET status = 'unreplied', snoozed_until = NULL, updated_at = datetime('now')
      WHERE user_id = ? AND status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= datetime('now')
    `).run(req.user.id);

    let query = 'SELECT * FROM todos WHERE user_id = ?';
    const params = [req.user.id];

    if (status && ['unreplied', 'snoozed', 'done'].includes(status)) {
      query += ' AND status = ?';
      params.push(status);
    }
    query += ' ORDER BY last_message_time DESC';

    const todos = db.prepare(query).all(...params);
    res.json({ todos });
  } catch (err) {
    console.error('Get todos error:', err);
    res.status(500).json({ error: 'Failed to fetch todos' });
  }
});

// GET /api/todos/stats
router.get('/stats', authenticate, (req, res) => {
  try {
    const db = getDb();

    // Un-snooze expired
    db.prepare(`
      UPDATE todos SET status = 'unreplied', snoozed_until = NULL, updated_at = datetime('now')
      WHERE user_id = ? AND status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= datetime('now')
    `).run(req.user.id);

    const unreplied = db.prepare('SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND status = ?').get(req.user.id, 'unreplied');
    const snoozed = db.prepare('SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND status = ?').get(req.user.id, 'snoozed');
    const done = db.prepare('SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND status = ?').get(req.user.id, 'done');

    // Get reminder rules for calculating overdue/due soon
    const rules = db.prepare('SELECT * FROM reminder_rules WHERE user_id = ?').get(req.user.id);
    const remindAfter = rules ? rules.remind_after_minutes : 30;
    const escalationHours = rules ? rules.escalation_hours : 0;

    // Overdue: unreplied todos where time since message > remind_after_minutes
    const overdue = db.prepare(`
      SELECT COUNT(*) as count FROM todos
      WHERE user_id = ? AND status = 'unreplied'
      AND datetime(last_message_time, '+' || ? || ' minutes') <= datetime('now')
    `).get(req.user.id, remindAfter);

    // Due soon: unreplied todos where time since message > (remind_after_minutes - 5) but not yet overdue
    const dueSoon = db.prepare(`
      SELECT COUNT(*) as count FROM todos
      WHERE user_id = ? AND status = 'unreplied'
      AND datetime(last_message_time, '+' || ? || ' minutes') > datetime('now')
      AND datetime(last_message_time, '+' || ? || ' minutes') <= datetime('now')
    `).get(req.user.id, remindAfter, Math.max(remindAfter - 5, 0));

    res.json({
      unreplied: unreplied.count,
      snoozed: snoozed.count,
      done: done.count,
      overdue: overdue.count,
      dueSoon: dueSoon.count
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// PUT /api/todos/:id/done
router.put('/:id/done', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare(`
      UPDATE todos SET status = 'done', done_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.user.id);
    const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    res.json({ todo });
  } catch (err) {
    console.error('Mark done error:', err);
    res.status(500).json({ error: 'Failed to mark as done' });
  }
});

// PUT /api/todos/:id/snooze
router.put('/:id/snooze', authenticate, (req, res) => {
  try {
    const { minutes } = req.body; // 15, 60, or 'eod' for end of day
    const db = getDb();

    let snoozedUntil;
    if (minutes === 'eod') {
      // End of day = today at 23:59
      const now = new Date();
      now.setHours(23, 59, 59, 0);
      snoozedUntil = now.toISOString().replace('T', ' ').substring(0, 19);
    } else {
      const mins = parseInt(minutes) || 15;
      const until = new Date(Date.now() + mins * 60 * 1000);
      snoozedUntil = until.toISOString().replace('T', ' ').substring(0, 19);
    }

    db.prepare(`
      UPDATE todos SET status = 'snoozed', snoozed_until = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(snoozedUntil, req.params.id, req.user.id);
    const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    res.json({ todo });
  } catch (err) {
    console.error('Snooze error:', err);
    res.status(500).json({ error: 'Failed to snooze' });
  }
});

// PUT /api/todos/:id/unreply - move back to unreplied
router.put('/:id/unreply', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare(`
      UPDATE todos SET status = 'unreplied', snoozed_until = NULL, done_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.user.id);
    const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    res.json({ todo });
  } catch (err) {
    console.error('Unreply error:', err);
    res.status(500).json({ error: 'Failed to move to unreplied' });
  }
});

// PUT /api/todos/:id/note
router.put('/:id/note', authenticate, (req, res) => {
  try {
    const { note } = req.body;
    const db = getDb();
    db.prepare(`
      UPDATE todos SET note = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(note || '', req.params.id, req.user.id);
    const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    res.json({ todo });
  } catch (err) {
    console.error('Add note error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// POST /api/todos/:id/reply - Send a reply via WhatsApp/Instagram and mark as done
router.post('/:id/reply', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const db = getDb();
    const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    // Check if the channel API is configured
    const configured = isChannelConfigured(todo.channel_type);

    if (!configured) {
      return res.status(400).json({
        error: `${todo.channel_type === 'whatsapp' ? 'WhatsApp' : 'Instagram'} API is not configured. Set the required environment variables.`,
        needs_config: true
      });
    }

    // Send the message via Meta API
    const result = await sendMessage(todo.channel_type, todo.contact_handle, message.trim());

    if (!result.success) {
      return res.status(502).json({
        error: `Failed to send message: ${result.error}`,
        api_error: true
      });
    }

    // Save outbound message
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(todo.conversation_id);
    if (conversation) {
      const msgId = uuidv4();
      db.prepare('INSERT INTO messages (id, conversation_id, user_id, direction, content) VALUES (?, ?, ?, ?, ?)')
        .run(msgId, conversation.id, req.user.id, 'outbound', message.trim());
    }

    // Mark todo as done
    db.prepare(`
      UPDATE todos SET status = 'done', done_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(todo.id, req.user.id);

    const updatedTodo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todo.id);

    res.json({
      todo: updatedTodo,
      sent: true,
      messageId: result.messageId
    });
  } catch (err) {
    console.error('Reply error:', err);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// GET /api/todos/channel-status - Check which channels have API configured
router.get('/channel-status', authenticate, (req, res) => {
  res.json({
    whatsapp: isChannelConfigured('whatsapp'),
    instagram: isChannelConfigured('instagram'),
  });
});

module.exports = router;
