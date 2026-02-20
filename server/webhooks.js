const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { getPlanLimits, incrementTodoUsage } = require('./billing');

const router = express.Router();

// Webhook verify token - set this in Railway env vars
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'replyping-verify-2026';

// Helper: process inbound message and create/update todo
function processInboundMessage(userId, channelType, contactName, contactHandle, messageContent, externalConvId) {
  const db = getDb();

  // Find or create channel
  let channel = db.prepare('SELECT * FROM channels WHERE user_id = ? AND type = ?').get(userId, channelType);
  if (!channel) {
    const channelId = uuidv4();
    db.prepare('INSERT INTO channels (id, user_id, type, name) VALUES (?, ?, ?, ?)')
      .run(channelId, userId, channelType, channelType === 'instagram' ? 'My Instagram' : 'My WhatsApp');
    channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  }

  // Find or create conversation
  let conversation = db.prepare('SELECT * FROM conversations WHERE user_id = ? AND channel_type = ? AND contact_handle = ?')
    .get(userId, channelType, contactHandle);

  if (!conversation) {
    const convId = uuidv4();
    db.prepare(`INSERT INTO conversations (id, user_id, channel_id, channel_type, contact_name, contact_handle, external_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(convId, userId, channel.id, channelType, contactName, contactHandle, externalConvId || '');
    conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  } else {
    db.prepare("UPDATE conversations SET contact_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(contactName, conversation.id);
  }

  // Save message
  const msgId = uuidv4();
  db.prepare('INSERT INTO messages (id, conversation_id, user_id, direction, content) VALUES (?, ?, ?, ?, ?)')
    .run(msgId, conversation.id, userId, 'inbound', messageContent);

  // Create or update todo
  let todo = db.prepare("SELECT * FROM todos WHERE user_id = ? AND conversation_id = ? AND status != 'done'")
    .get(userId, conversation.id);

  if (todo) {
    db.prepare(`UPDATE todos SET
      last_message_preview = ?, last_message_time = datetime('now'),
      status = 'unreplied', snoozed_until = NULL, reminder_sent = 0, escalation_sent = 0,
      updated_at = datetime('now')
      WHERE id = ?`)
      .run(messageContent.substring(0, 200), todo.id);
    todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todo.id);
  } else {
    // Check plan limits before creating new todo
    const limits = getPlanLimits(userId);
    if (limits && !limits.can_create_todo) {
      return { conversation, message: { id: msgId }, todo: null, limit_reached: true };
    }

    const todoId = uuidv4();
    db.prepare(`INSERT INTO todos (id, user_id, conversation_id, channel_type, contact_name, contact_handle, last_message_preview, last_message_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(todoId, userId, conversation.id, channelType, contactName, contactHandle, messageContent.substring(0, 200));
    todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId);

    // Increment usage counter
    incrementTodoUsage(userId);
  }

  return { conversation, message: { id: msgId }, todo };
}

// Helper: process outbound message - marks todo as done
function processOutboundMessage(userId, channelType, contactHandle, messageContent) {
  const db = getDb();

  const conversation = db.prepare('SELECT * FROM conversations WHERE user_id = ? AND channel_type = ? AND contact_handle = ?')
    .get(userId, channelType, contactHandle);

  if (!conversation) return null;

  // Save outbound message
  const msgId = uuidv4();
  db.prepare('INSERT INTO messages (id, conversation_id, user_id, direction, content) VALUES (?, ?, ?, ?, ?)')
    .run(msgId, conversation.id, userId, 'outbound', messageContent);

  // Mark todo as done
  const todo = db.prepare("SELECT * FROM todos WHERE user_id = ? AND conversation_id = ? AND status != 'done'")
    .get(userId, conversation.id);
  if (todo) {
    db.prepare("UPDATE todos SET status = 'done', done_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(todo.id);
  }

  return { conversation, message: { id: msgId }, todo };
}

// POST /webhooks/instagram
// Receives real Instagram Messaging API webhooks from Meta
router.post('/instagram', (req, res) => {
  try {
    const { entry } = req.body;

    if (!entry || !entry.length) {
      return res.status(400).json({ error: 'No entry data' });
    }

    const db = getDb();
    const results = [];

    for (const e of entry) {
      if (!e.messaging) continue;
      for (const msg of e.messaging) {
        // Find user by channel config or use first user (for demo)
        const user = db.prepare('SELECT u.* FROM users u JOIN channels c ON c.user_id = u.id WHERE c.type = ? LIMIT 1').get('instagram');
        if (!user) continue;

        if (msg.message) {
          const result = processInboundMessage(
            user.id,
            'instagram',
            msg.sender?.name || `IG User ${msg.sender?.id?.substring(0, 6) || 'unknown'}`,
            msg.sender?.id || 'unknown',
            msg.message.text || '[Media]',
            msg.sender?.id
          );
          results.push(result);
        }
      }
    }

    res.json({ status: 'ok', processed: results.length });
  } catch (err) {
    console.error('Instagram webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /webhooks/instagram - Verification endpoint (Meta sends this to confirm your webhook URL)
router.get('/instagram', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WEBHOOK_VERIFY_TOKEN) {
    console.log('Instagram webhook verified successfully');
    return res.send(req.query['hub.challenge']);
  }
  console.warn('Instagram webhook verification failed. Token mismatch.');
  res.status(403).send('Verification failed');
});

// POST /webhooks/whatsapp
// Receives real WhatsApp Cloud API webhooks from Meta
router.post('/whatsapp', (req, res) => {
  try {
    const { entry } = req.body;

    if (!entry || !entry.length) {
      return res.status(400).json({ error: 'No entry data' });
    }

    const db = getDb();
    const results = [];

    for (const e of entry) {
      const changes = e.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const msg of messages) {
          const user = db.prepare('SELECT u.* FROM users u JOIN channels c ON c.user_id = u.id WHERE c.type = ? LIMIT 1').get('whatsapp');
          if (!user) continue;

          const contact = contacts.find(c => c.wa_id === msg.from) || {};
          const contactName = contact.profile?.name || `+${msg.from}`;

          let content = '[Message]';
          if (msg.type === 'text' && msg.text) content = msg.text.body;
          else if (msg.type === 'image') content = '[Image]';
          else if (msg.type === 'video') content = '[Video]';
          else if (msg.type === 'audio') content = '[Audio]';
          else if (msg.type === 'document') content = '[Document]';

          const result = processInboundMessage(
            user.id,
            'whatsapp',
            contactName,
            msg.from || 'unknown',
            content,
            msg.from
          );
          results.push(result);
        }
      }
    }

    res.json({ status: 'ok', processed: results.length });
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /webhooks/whatsapp - Verification endpoint (Meta sends this to confirm your webhook URL)
router.get('/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WEBHOOK_VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified successfully');
    return res.send(req.query['hub.challenge']);
  }
  console.warn('WhatsApp webhook verification failed. Token mismatch.');
  res.status(403).send('Verification failed');
});

// POST /api/dev/simulate - Dev panel endpoint for sending test messages
router.post('/simulate', (req, res) => {
  try {
    const { channel, contact_name, contact_handle, message, direction } = req.body;

    if (!channel || !message) {
      return res.status(400).json({ error: 'channel and message are required' });
    }

    const db = getDb();
    // For dev panel, find first user or use provided user_id
    const userId = req.body.user_id || db.prepare('SELECT id FROM users LIMIT 1').get()?.id;
    if (!userId) {
      return res.status(400).json({ error: 'No users found. Register first.' });
    }

    const name = contact_name || (channel === 'instagram' ? 'test_ig_user' : '+15551234567');
    const handle = contact_handle || name;

    let result;
    if (direction === 'outbound') {
      result = processOutboundMessage(userId, channel, handle, message);
    } else {
      result = processInboundMessage(userId, channel, name, handle, message);
    }

    res.json({ status: 'ok', result });
  } catch (err) {
    console.error('Simulate error:', err);
    res.status(500).json({ error: 'Simulation failed' });
  }
});

module.exports = router;
