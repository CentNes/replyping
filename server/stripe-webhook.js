const express = require('express');
const { getDb } = require('./database');

const router = express.Router();

// POST /webhooks/stripe - handle Stripe webhook events
// NOTE: This route uses express.raw() for signature verification
router.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  let event;

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret && sig) {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // No webhook secret configured - parse raw body
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getDb();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.replyping_user_id;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (userId) {
          db.prepare(`UPDATE users SET
            plan = 'premium',
            stripe_customer_id = ?,
            stripe_subscription_id = ?,
            subscription_status = 'active',
            updated_at = datetime('now')
            WHERE id = ?`
          ).run(customerId, subscriptionId, userId);
          console.log(`User ${userId} upgraded to premium via Stripe`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status; // active, past_due, canceled, etc.
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId);
        if (user) {
          const plan = (status === 'active' || status === 'trialing') ? 'premium' : 'free';
          db.prepare(`UPDATE users SET
            plan = ?,
            subscription_status = ?,
            subscription_ends_at = ?,
            stripe_subscription_id = ?,
            updated_at = datetime('now')
            WHERE id = ?`
          ).run(plan, status, periodEnd, subscription.id, user.id);
          console.log(`User ${user.id} subscription updated: ${status}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId);
        if (user) {
          db.prepare(`UPDATE users SET
            plan = 'free',
            subscription_status = 'canceled',
            stripe_subscription_id = NULL,
            updated_at = datetime('now')
            WHERE id = ?`
          ).run(user.id);
          console.log(`User ${user.id} subscription canceled`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId);
        if (user) {
          db.prepare(`UPDATE users SET subscription_status = 'past_due', updated_at = datetime('now') WHERE id = ?`)
            .run(user.id);
          console.log(`User ${user.id} payment failed`);
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Stripe webhook processing error:', err);
  }

  res.json({ received: true });
});

module.exports = router;
