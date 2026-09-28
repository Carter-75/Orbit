import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createStripeEvents } from '../src/stripe-events.js';
import { readPaymentConfig, STRIPE_API_VERSION } from '../src/payment-config.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

const secret = 'whsec_localTestFixtureOnly', sdk = new Stripe('sk_test_localFixtureOnly');
const paymentConfig = { mode: 'test', secretKey: 'sk_test_localFixtureOnly', webhookSecret: secret };
let mongo, client, db;
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('stripe-tests'); });
beforeEach(async () => { await db.dropDatabase(); });
after(async () => { await client?.close(); await mongo?.stop(); });
const event = (id = 'evt_one', values = {}) => ({ id, object: 'event', type: 'invoice.paid', livemode: false,
  api_version: STRIPE_API_VERSION, created: Math.floor(Date.now() / 1000),
  data: { object: { id: 'in_one', object: 'invoice', customer_email: 'private@example.test', amount_paid: 500 } }, ...values });
function send(app, value, { timestamp, tamper = false, path = '/' } = {}) {
  const payload = JSON.stringify(value);
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
  return request(app).post(path).set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(tamper ? `${payload} ` : payload);
}
async function fixture(handlers = {}, events = new Map()) {
  const retrieved = [];
  const provider = { webhooks: sdk.webhooks, events: { retrieve: async (id, _params, options) => {
    retrieved.push({ id, options }); if (!events.has(id)) throw new Error('provider secret should not escape'); return events.get(id);
  } } };
  const service = await createStripeEvents({ db, config: paymentConfig, handlers, provider });
  const app = express(); app.use(service.router); return { ...service, app, events, retrieved };
}

test('payment configuration is disabled by default and rejects live keys/mode or incomplete test setup', () => {
  assert.deepEqual(readPaymentConfig({}), { mode: 'disabled' });
  assert.throws(() => readPaymentConfig({ PAYMENTS_MODE: 'live' }));
  assert.throws(() => readPaymentConfig({ PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_live_no', STRIPE_WEBHOOK_SECRET: secret }));
  assert.throws(() => readPaymentConfig({ PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_no' }));
  assert.equal(readPaymentConfig({ PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_no', STRIPE_WEBHOOK_SECRET: secret }).apiVersion, STRIPE_API_VERSION);
});

test('real signature validation rejects tampering, stale signatures, live events and wrong versions; stores minimal durable references', async () => {
  const { app } = await fixture();
  for (const [value, options] of [[event(), { tamper: true }], [event(), { timestamp: 1 }],
    [event('evt_live', { livemode: true }), {}], [event('evt_old', { api_version: '2020-01-01' }), {}],
    [event('evt_org', { context: 'acct_org' }), {}]]) assert.equal((await send(app, value, options)).status, 400);
  assert.equal((await request(app).post('/').send(event())).status, 400);
  const accepted = await send(app, event()); assert.equal(accepted.status, 200); assert.equal(accepted.headers['cache-control'], 'no-store');
  await Promise.all(Array.from({ length: 5 }, () => send(app, event())));
  assert.equal(await db.collection('stripeEvents').countDocuments(), 1);
  const stored = await db.collection('stripeEvents').findOne();
  assert.equal(stored.status, 'awaiting_handler');
  assert.equal(JSON.stringify(stored).includes('private@example.test'), false);
  assert.equal(Object.hasOwn(stored, 'data'), false);
  assert.equal((await send(app, event('evt_ignored', { type: 'customer.created' }))).body.ignored, true);
  assert.equal(await db.collection('stripeEvents').countDocuments(), 1);
});

test('concurrent workers lease once and duplicate delivery never repeats completed processing', async () => {
  let calls = 0;
  const handlers = { 'invoice.paid': async ({ eventKey, isCurrent }) => { calls++; assert.equal(await isCurrent(), true); assert.match(eventKey, /^[a-f0-9]{64}$/); } };
  const a = await fixture(handlers); a.events.set('evt_one', event());
  const b = await fixture(handlers, a.events);
  await send(a.app, event());
  await Promise.all([a.drain(), b.drain()]); assert.equal(calls, 1);
  assert.equal((await db.collection('stripeEvents').findOne()).status, 'completed');
  await send(a.app, event()); await b.drain(); assert.equal(calls, 1);
  assert.deepEqual(a.retrieved.concat(b.retrieved), [{ id: 'evt_one', options: {} }]);
});

test('failed retrieval retries without leaking provider errors and exhausted leases reach a visible failed state', async () => {
  const service = await fixture({ 'invoice.paid': async () => {} });
  await send(service.app, event());
  assert.equal((await service.drain()).retried, 1);
  let stored = await db.collection('stripeEvents').findOne();
  assert.equal(stored.attempts, 1); assert.equal(stored.failureCode, 'processing_failed');
  assert.ok(stored.nextAttemptAt > new Date()); assert.equal(JSON.stringify(stored).includes('secret'), false);
  assert.equal((await service.drain()).retried, 0);
  await db.collection('stripeEvents').updateOne({ _id: stored._id }, { $set: { status: 'processing', leaseToken: 'crashed', leaseUntil: new Date(0), attempts: 8 } });
  await service.drain(); stored = await db.collection('stripeEvents').findOne();
  assert.equal(stored.status, 'failed'); assert.equal(stored.failureCode, 'attempts_exhausted');
  assert.equal(Object.hasOwn(stored, 'leaseToken'), false);
});

test('new handlers recover awaiting entries and stale workers cannot acknowledge a replaced lease', async () => {
  const pending = await fixture(); await send(pending.app, event());
  let completed = 0;
  const service = await fixture({ 'invoice.paid': async ({ eventKey, isCurrent }) => {
    await db.collection('stripeEvents').updateOne({ _id: eventKey }, { $set: { leaseToken: 'other-worker' } });
    assert.equal(await isCurrent(), false); completed++;
  } }); service.events.set('evt_one', event());
  assert.equal((await service.drain()).lostLease, 1); assert.equal(completed, 1);
  assert.equal((await db.collection('stripeEvents').findOne()).status, 'processing');
});

test('crash-after-effect replay uses the same idempotency identity and an expired lease is recoverable', async () => {
  let attempts = 0;
  const service = await fixture({ 'invoice.paid': async ({ eventKey }) => {
    // Illustrative atomic effect, not an implemented financial ledger.
    await db.collection('testEffects').updateOne({ _id: eventKey }, { $setOnInsert: { applied: true } }, { upsert: true });
    if (++attempts === 1) throw new Error('crash after effect');
  } }); service.events.set('evt_one', event());
  await send(service.app, event()); assert.equal((await service.drain()).retried, 1);
  await db.collection('stripeEvents').updateMany({}, { $set: { status: 'processing', leaseUntil: new Date(0), leaseToken: 'abandoned' } });
  assert.equal((await service.drain()).completed, 1); assert.equal(attempts, 2);
  assert.equal(await db.collection('testEffects').countDocuments(), 1);
});

test('durable storage failure asks the provider to retry instead of acknowledging lost work', async () => {
  const collection = db.collection('stripeEvents');
  collection.insertOne = async () => { throw new Error('database URI must not escape'); };
  const service = await createStripeEvents({ db: { collection: () => collection }, config: paymentConfig,
    provider: { webhooks: sdk.webhooks } });
  const app = express(); app.use(service.router);
  const result = await send(app, event()); assert.equal(result.status, 503);
  assert.equal(result.text.includes('database URI'), false);
});

test('connected scope is preserved and retrieved events cannot switch mode, scope or object identity', async () => {
  let calls = 0;
  const service = await fixture({ 'invoice.paid': async () => { calls++; } });
  const connected = event('evt_connected', { account: 'acct_creator' });
  await send(service.app, connected);
  service.events.set(connected.id, { ...connected, livemode: true });
  assert.equal((await service.drain()).retried, 1); assert.equal(calls, 0);
  assert.deepEqual(service.retrieved[0].options, { stripeAccount: 'acct_creator' });
  await db.collection('stripeEvents').updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  service.events.set(connected.id, connected); assert.equal((await service.drain()).completed, 1); assert.equal(calls, 1);
});

test('full app accepts raw signed provider delivery without browser Origin but retains browser CSRF protection', async () => {
  const config = readConfig({ MONGODB_URI: mongo.getUri(), PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_localFixtureOnly', STRIPE_WEBHOOK_SECRET: secret });
  const { app } = await createApp({ db, config, sendMail: null });
  assert.equal((await send(app, event(), { path: '/api/payments/webhook' })).status, 200);
  assert.equal((await request(app).post('/api/auth/logout').send({})).status, 403);
  assert.equal((await request(app).post('/api/payments/other').send({})).status, 403);
  assert.equal((await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').send('x'.repeat(270000))).status, 413);
  const disabled = await createStripeEvents({ db, config: { mode: 'disabled' } }); const other = express(); other.use(disabled.router);
  assert.equal((await send(other, event())).status, 503);
});
