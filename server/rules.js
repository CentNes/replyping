const express = require('express');
const { getDb } = require('./database');
const { authenticate } = require('./auth');
const { getPlanLimits } = require('./billing');

const router = express.Router();

// GET /api/rules
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    let rules = db.prepare('SELECT * FROM reminder_rules WHERE user_id = ?').get(req.user.id);
    if (!rules) {
      const { v4: uuidv4 } = require('uuid');
      db.prepare('INSERT INTO reminder_rules (id, user_id) VALUES (?, ?)').run(uuidv4(), req.user.id);
      rules = db.prepare('SELECT * FROM reminder_rules WHERE user_id = ?').get(req.user.id);
    }
    res.json({ rules });
  } catch (err) {
    console.error('Get rules error:', err);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// PUT /api/rules
router.put('/', authenticate, (req, res) => {
  try {
    const { remind_after_minutes, business_hours_start, business_hours_end, weekend_enabled, escalation_hours } = req.body;
    const db = getDb();

    // Check plan limits for premium features
    const limits = getPlanLimits(req.user.id);
    if (limits) {
      if (!limits.custom_reminders && remind_after_minutes && ![15, 30, 60].includes(remind_after_minutes)) {
        return res.status(403).json({ error: 'Custom reminder intervals require Premium plan', upgrade: true });
      }
      if (!limits.escalation && escalation_hours && escalation_hours > 0) {
        return res.status(403).json({ error: 'Escalation alerts require Premium plan', upgrade: true });
      }
    }

    db.prepare(`
      UPDATE reminder_rules SET
        remind_after_minutes = COALESCE(?, remind_after_minutes),
        business_hours_start = COALESCE(?, business_hours_start),
        business_hours_end = COALESCE(?, business_hours_end),
        weekend_enabled = COALESCE(?, weekend_enabled),
        escalation_hours = COALESCE(?, escalation_hours),
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      remind_after_minutes ?? null,
      business_hours_start ?? null,
      business_hours_end ?? null,
      weekend_enabled != null ? (weekend_enabled ? 1 : 0) : null,
      escalation_hours ?? null,
      req.user.id
    );

    const rules = db.prepare('SELECT * FROM reminder_rules WHERE user_id = ?').get(req.user.id);
    res.json({ rules });
  } catch (err) {
    console.error('Update rules error:', err);
    res.status(500).json({ error: 'Failed to update rules' });
  }
});

module.exports = router;
