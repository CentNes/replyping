const express = require('express');
const { getDb } = require('./database');
const { authenticate } = require('./auth');

const router = express.Router();

// Plan definitions
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    max_active_todos: 50,
    max_channels: 2,
    custom_reminders: false,
    escalation: false,
    features: [
      '2 channels (Instagram + WhatsApp)',
      'Up to 50 active to-dos/month',
      'Standard reminders (15/30/60 min)',
      'Business hours settings',
    ]
  },
  premium: {
    name: 'Premium',
    price: 9,
    max_active_todos: -1, // unlimited
    max_channels: -1,     // unlimited
    custom_reminders: true,
    escalation: true,
    features: [
      'Unlimited channels',
      'Unlimited to-dos',
      'Custom reminder intervals',
      'Escalation alerts',
      'Priority support',
      'Everything in Free',
    ]
  }
};

// Initialize Stripe only if key is available
let stripe = null;
function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

// GET /api/billing/plans - list available plans
router.get('/plans', (req, res) => {
  res.json({ plans: PLANS });
});

// GET /api/billing/status - get current user's subscription status
router.get('/status', authenticate, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, email, name, plan, stripe_customer_id, subscription_status,
             subscription_ends_at, todos_used_this_month, todos_month
      FROM users WHERE id = ?
    `).get(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Reset monthly counter if new month
    const currentMonth = new Date().toISOString().substring(0, 7); // "2026-02"
    if (user.todos_month !== currentMonth) {
      db.prepare('UPDATE users SET todos_used_this_month = 0, todos_month = ? WHERE id = ?')
        .run(currentMonth, user.id);
      user.todos_used_this_month = 0;
      user.todos_month = currentMonth;
    }

    const planDetails = PLANS[user.plan] || PLANS.free;
    res.json({
      plan: user.plan,
      plan_details: planDetails,
      subscription_status: user.subscription_status,
      subscription_ends_at: user.subscription_ends_at,
      usage: {
        todos_used: user.todos_used_this_month,
        todos_limit: planDetails.max_active_todos,
        todos_remaining: planDetails.max_active_todos === -1 ? -1 : Math.max(0, planDetails.max_active_todos - user.todos_used_this_month),
      }
    });
  } catch (err) {
    console.error('Billing status error:', err);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
});

// POST /api/billing/checkout - create Stripe Checkout session
router.post('/checkout', authenticate, (req, res) => {
  try {
    const s = getStripe();
    if (!s) {
      return res.status(503).json({
        error: 'Stripe not configured',
        message: 'Set STRIPE_SECRET_KEY environment variable to enable payments. For demo purposes, you can use the "Activate Premium (Demo)" button instead.'
      });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    // Create or retrieve Stripe customer
    const createCheckout = async () => {
      let customerId = user.stripe_customer_id;

      if (!customerId) {
        const customer = await s.customers.create({
          email: user.email,
          name: user.name,
          metadata: { replyping_user_id: user.id }
        });
        customerId = customer.id;
        db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
      }

      const baseUrl = req.headers.origin || `${req.protocol}://${req.get('host')}`;

      const session = await s.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        }],
        success_url: `${baseUrl}/?billing=success`,
        cancel_url: `${baseUrl}/?billing=canceled`,
        metadata: { replyping_user_id: user.id }
      });

      res.json({ checkout_url: session.url, session_id: session.id });
    };

    createCheckout().catch(err => {
      console.error('Stripe checkout error:', err);
      res.status(500).json({ error: 'Failed to create checkout session' });
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

// POST /api/billing/portal - create Stripe Customer Portal session (manage subscription)
router.post('/portal', authenticate, (req, res) => {
  try {
    const s = getStripe();
    if (!s) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    const db = getDb();
    const user = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(req.user.id);

    if (!user?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found' });
    }

    const createPortal = async () => {
      const baseUrl = req.headers.origin || `${req.protocol}://${req.get('host')}`;
      const session = await s.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${baseUrl}/?screen=billing`,
      });
      res.json({ portal_url: session.url });
    };

    createPortal().catch(err => {
      console.error('Stripe portal error:', err);
      res.status(500).json({ error: 'Failed to create portal session' });
    });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Failed to create portal' });
  }
});

// POST /api/billing/demo-upgrade - for demo/testing without real Stripe
router.post('/demo-upgrade', authenticate, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(req.user.id);

    if (user.plan === 'premium') {
      // Downgrade to free
      db.prepare(`UPDATE users SET plan = 'free', subscription_status = 'none', subscription_ends_at = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(req.user.id);
      res.json({ plan: 'free', message: 'Downgraded to Free plan' });
    } else {
      // Upgrade to premium
      const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`UPDATE users SET plan = 'premium', subscription_status = 'active', subscription_ends_at = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(endsAt, req.user.id);
      res.json({ plan: 'premium', message: 'Upgraded to Premium! (Demo mode)' });
    }
  } catch (err) {
    console.error('Demo upgrade error:', err);
    res.status(500).json({ error: 'Failed to toggle plan' });
  }
});

// Helper: check if user can perform action based on plan
function getPlanLimits(userId) {
  const db = getDb();
  const user = db.prepare('SELECT plan, todos_used_this_month, todos_month FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  // Reset monthly counter if new month
  const currentMonth = new Date().toISOString().substring(0, 7);
  if (user.todos_month !== currentMonth) {
    db.prepare('UPDATE users SET todos_used_this_month = 0, todos_month = ? WHERE id = ?')
      .run(currentMonth, userId);
    user.todos_used_this_month = 0;
  }

  const planDetails = PLANS[user.plan] || PLANS.free;
  return {
    plan: user.plan,
    ...planDetails,
    todos_used: user.todos_used_this_month,
    can_create_todo: planDetails.max_active_todos === -1 || user.todos_used_this_month < planDetails.max_active_todos,
  };
}

// Helper: increment todo usage counter
function incrementTodoUsage(userId) {
  const db = getDb();
  const currentMonth = new Date().toISOString().substring(0, 7);
  db.prepare(`UPDATE users SET todos_used_this_month = todos_used_this_month + 1, todos_month = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(currentMonth, userId);
}

module.exports = { router, PLANS, getPlanLimits, incrementTodoUsage };
