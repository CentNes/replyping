const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'replyping.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'premium')),
      stripe_customer_id TEXT DEFAULT NULL,
      stripe_subscription_id TEXT DEFAULT NULL,
      subscription_status TEXT DEFAULT 'none' CHECK(subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing')),
      subscription_ends_at TEXT DEFAULT NULL,
      todos_used_this_month INTEGER DEFAULT 0,
      todos_month TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('instagram', 'whatsapp')),
      name TEXT NOT NULL DEFAULT '',
      connected INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_type TEXT NOT NULL CHECK(channel_type IN ('instagram', 'whatsapp')),
      contact_name TEXT NOT NULL DEFAULT 'Unknown',
      contact_handle TEXT NOT NULL DEFAULT '',
      contact_avatar TEXT DEFAULT '',
      external_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (channel_id) REFERENCES channels(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      content TEXT NOT NULL DEFAULT '',
      external_id TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      channel_type TEXT NOT NULL CHECK(channel_type IN ('instagram', 'whatsapp')),
      contact_name TEXT NOT NULL DEFAULT 'Unknown',
      contact_handle TEXT NOT NULL DEFAULT '',
      last_message_preview TEXT DEFAULT '',
      last_message_time TEXT DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'unreplied' CHECK(status IN ('unreplied', 'snoozed', 'done')),
      snoozed_until TEXT DEFAULT NULL,
      note TEXT DEFAULT '',
      reminder_sent INTEGER DEFAULT 0,
      escalation_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      done_at TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS reminder_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      remind_after_minutes INTEGER DEFAULT 30,
      business_hours_start TEXT DEFAULT '09:00',
      business_hours_end TEXT DEFAULT '17:00',
      weekend_enabled INTEGER DEFAULT 0,
      escalation_hours INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      todo_id TEXT,
      type TEXT NOT NULL CHECK(type IN ('reminder', 'escalation', 'info')),
      channel TEXT NOT NULL DEFAULT 'in_app' CHECK(channel IN ('in_app', 'email', 'both')),
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      read INTEGER DEFAULT 0,
      email_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (todo_id) REFERENCES todos(id)
    );

    CREATE INDEX IF NOT EXISTS idx_todos_user_status ON todos(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_todos_snoozed ON todos(status, snoozed_until);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_external ON conversations(external_id, channel_type);
  `);

  // Migration: add subscription columns to existing users table
  try {
    db.exec(`ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'`);
  } catch (e) { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT DEFAULT NULL`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT DEFAULT NULL`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'none'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN subscription_ends_at TEXT DEFAULT NULL`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN todos_used_this_month INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN todos_month TEXT DEFAULT NULL`);
  } catch (e) {}

  console.log('Database initialized successfully');
}

// Create a demo user for testing
function seedDemoUser() {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@replyping.com');
  if (!existing) {
    const id = uuidv4();
    const hash = bcrypt.hashSync('demo123', 10);
    db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(id, 'demo@replyping.com', hash, 'Demo User');

    // Create default channels
    const igChannel = uuidv4();
    const waChannel = uuidv4();
    db.prepare('INSERT INTO channels (id, user_id, type, name) VALUES (?, ?, ?, ?)').run(igChannel, id, 'instagram', 'My Instagram');
    db.prepare('INSERT INTO channels (id, user_id, type, name) VALUES (?, ?, ?, ?)').run(waChannel, id, 'whatsapp', 'My WhatsApp');

    // Create default reminder rules
    db.prepare('INSERT INTO reminder_rules (id, user_id) VALUES (?, ?)').run(uuidv4(), id);

    console.log('Demo user created: demo@replyping.com / demo123');
  }
}

module.exports = { getDb, initDatabase, seedDemoUser };
