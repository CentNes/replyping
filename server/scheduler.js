const cron = require('node-cron');
const { getDb } = require('./database');
const { createNotification } = require('./notifications');

function startScheduler() {
  // Run every minute
  cron.schedule('* * * * *', () => {
    try {
      checkReminders();
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  });

  console.log('Reminder scheduler started (runs every minute)');
}

function checkReminders() {
  const db = getDb();

  // Get all users with their rules
  const users = db.prepare('SELECT u.id as user_id, u.email, r.* FROM users u LEFT JOIN reminder_rules r ON r.user_id = u.id').all();

  for (const user of users) {
    const remindAfter = user.remind_after_minutes || 30;
    const escalationHours = user.escalation_hours || 0;
    const businessStart = user.business_hours_start || '09:00';
    const businessEnd = user.business_hours_end || '17:00';
    const weekendEnabled = user.weekend_enabled || 0;

    // Check if within business hours
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
    const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend && !weekendEnabled) {
      continue; // Skip reminders on weekends if not enabled
    }

    if (currentTime < businessStart || currentTime > businessEnd) {
      continue; // Outside business hours
    }

    // Find unreplied todos that exceed the reminder threshold
    const overdueTodos = db.prepare(`
      SELECT * FROM todos
      WHERE user_id = ? AND status = 'unreplied' AND reminder_sent = 0
      AND datetime(last_message_time, '+' || ? || ' minutes') <= datetime('now')
    `).all(user.user_id, remindAfter);

    for (const todo of overdueTodos) {
      // Create reminder notification
      createNotification(
        user.user_id,
        todo.id,
        'reminder',
        `Reply needed: ${todo.contact_name}`,
        `You have an unreplied ${todo.channel_type} message from ${todo.contact_name} (@${todo.contact_handle}). Message: "${todo.last_message_preview}"`
      );

      // Mark reminder as sent
      db.prepare('UPDATE todos SET reminder_sent = 1, updated_at = datetime(\'now\') WHERE id = ?').run(todo.id);
    }

    // Check for escalation (if configured)
    if (escalationHours > 0) {
      const escalationTodos = db.prepare(`
        SELECT * FROM todos
        WHERE user_id = ? AND status = 'unreplied' AND escalation_sent = 0
        AND datetime(last_message_time, '+' || ? || ' hours') <= datetime('now')
      `).all(user.user_id, escalationHours);

      for (const todo of escalationTodos) {
        createNotification(
          user.user_id,
          todo.id,
          'escalation',
          `URGENT: ${todo.contact_name} waiting ${escalationHours}h+`,
          `ESCALATION: ${todo.contact_name} (@${todo.contact_handle}) on ${todo.channel_type} has been waiting over ${escalationHours} hours for a reply! Message: "${todo.last_message_preview}"`
        );

        db.prepare('UPDATE todos SET escalation_sent = 1, updated_at = datetime(\'now\') WHERE id = ?').run(todo.id);
      }
    }

    // Un-snooze todos whose snooze time has passed
    db.prepare(`
      UPDATE todos SET status = 'unreplied', snoozed_until = NULL, updated_at = datetime('now')
      WHERE user_id = ? AND status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= datetime('now')
    `).run(user.user_id);
  }
}

module.exports = { startScheduler, checkReminders };
