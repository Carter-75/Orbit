import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from './payment-config.js';

const TYPES = new Set(['account.updated', 'checkout.session.completed', 'checkout.session.expired',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
  'transfer.created', 'transfer.reversed', 'payout.paid', 'payout.failed']);
const MAX_ATTEMPTS = 8, LEASE_MS = 120000;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,255}$/.test(value);
const eventKey = event => createHash('sha256').update(JSON.stringify(['test', event.account || 'platform', event.id])).digest('hex');
function validEvent(event) {
  return event && identifier(event.id) && event.id.startsWith('evt_') && event.livemode === false &&
    event.api_version === STRIPE_API_VERSION && !event.context &&
    (!event.account || (identifier(event.account) && event.account.startsWith('acct_'))) &&
    typeof event.type === 'string' && Number.isSafeInteger(event.created) && event.created > 0 &&
    identifier(event.data?.object?.id);
}

/** Durable intake, not fulfillment. Handlers must make their own financial
 * effects idempotent/transactional using eventKey; leases cannot promise exactly once. */
export async function createStripeEvents({ db, config = {}, handlers = {}, provider }) {
  const enabled = config.mode === 'test', inbox = db.collection('stripeEvents');
  const stripe = enabled ? (provider || new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1, timeout: 15000 })) : null;
  await inbox.createIndex({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/', rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Webhook intake busy. Retry later.' } }), raw({ type: 'application/json', limit: '256kb', inflate: false }), async (req, res) => {
    if (!enabled) return res.status(503).json({ error: 'Payment event intake is disabled.' });
    let event;
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error();
      event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.webhookSecret);
      if (!validEvent(event)) throw new Error();
    } catch { return res.status(400).json({ error: 'Invalid Stripe signature, event mode, scope or API version.' }); }
    if (!TYPES.has(event.type)) return res.json({ received: true, ignored: true });
    try {
      await inbox.insertOne({ _id: eventKey(event), eventId: event.id, type: event.type,
        account: event.account || null, objectId: event.data.object.id, eventCreated: event.created,
        mode: 'test', apiVersion: event.api_version, receivedAt: new Date(), attempts: 0,
        status: typeof handlers[event.type] === 'function' ? 'pending' : 'awaiting_handler', nextAttemptAt: new Date() });
    } catch (error) {
      if (error.code !== 11000) return res.status(503).json({ error: 'Payment event storage unavailable. Retry later.' });
      // A repeated delivery never changes processing state or grants access.
    }
    return res.json({ received: true });
  });
  router.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid payment event body.' }));

  async function drain({ limit = 10 } = {}) {
    const counts = { completed: 0, retried: 0, failed: 0, awaitingHandler: 0, lostLease: 0 };
    if (!enabled) return counts;
    const types = Object.keys(handlers).filter(type => TYPES.has(type) && typeof handlers[type] === 'function');
    // A newly deployed implementation explicitly activates its supported inbox entries.
    if (types.length) await inbox.updateMany({ status: 'awaiting_handler', type: { $in: types } }, { $set: { status: 'pending', nextAttemptAt: new Date() } });
    // A crash on the final attempt must not strand a processing row forever.
    await inbox.updateMany({ status: 'processing', leaseUntil: { $lte: new Date() }, attempts: { $gte: MAX_ATTEMPTS } },
      { $set: { status: 'failed', failureCode: 'attempts_exhausted', failedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } });
    for (let index = 0; index < Math.min(50, Math.max(0, limit)); index++) {
      const now = new Date(), leaseToken = randomUUID();
      const item = await inbox.findOneAndUpdate({ attempts: { $lt: MAX_ATTEMPTS }, $or: [
        { status: 'pending', nextAttemptAt: { $lte: now } }, { status: 'processing', leaseUntil: { $lte: now } },
      ] }, { $set: { status: 'processing', leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
      { sort: { receivedAt: 1 }, returnDocument: 'after' });
      if (!item) break;
      const owned = () => ({ _id: item._id, status: 'processing', leaseToken, leaseUntil: { $gt: new Date() } });
      try {
        const handler = Object.hasOwn(handlers, item.type) && handlers[item.type];
        if (typeof handler !== 'function') {
          await inbox.updateOne(owned(), { $set: { status: 'awaiting_handler' }, $unset: { leaseToken: '', leaseUntil: '' } });
          counts.awaitingHandler++; continue;
        }
        // Retrieve the canonical event using server credentials. No raw payment,
        // billing-address, card or customer payload is persisted in this inbox.
        const event = await stripe.events.retrieve(item.eventId, {}, item.account ? { stripeAccount: item.account } : {});
        if (!validEvent(event) || eventKey(event) !== item._id || event.type !== item.type || event.data.object.id !== item.objectId) throw new Error('event_mismatch');
        const isCurrent = async () => Boolean(await inbox.findOne(owned(), { projection: { _id: 1 } }));
        if (!await isCurrent()) { counts.lostLease++; continue; }
        await handler({ event, eventKey: item._id, isCurrent });
        const completed = await inbox.updateOne(owned(), { $set: { status: 'completed', completedAt: new Date() },
          $unset: { leaseToken: '', leaseUntil: '', failureCode: '', failedAt: '' } });
        completed.modifiedCount ? counts.completed++ : counts.lostLease++;
      } catch {
        const exhausted = item.attempts >= MAX_ATTEMPTS;
        const result = await inbox.updateOne(owned(), { $set: { status: exhausted ? 'failed' : 'pending', failureCode: 'processing_failed',
          nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** (item.attempts - 1))), ...(exhausted ? { failedAt: new Date() } : {}) },
          $unset: { leaseToken: '', leaseUntil: '' } });
        if (!result.modifiedCount) counts.lostLease++;
        else if (exhausted) counts.failed++; else counts.retried++;
      }
    }
    return counts;
  }
  return { router, drain, enabled };
}
