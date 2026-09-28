import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createLedger, stripeBalanceJournal } from '../src/ledger.js';

let mongo, client, db, ledger;
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('ledger-tests'); });
beforeEach(async () => { await db.dropDatabase(); ledger = await createLedger({ db, mode: 'test' }); });
after(async () => { await client?.close(); await mongo?.stop(); });
const journal = (objectId = 'invoice_one', overrides = {}) => ({
  source: { provider: 'orbit', scope: 'platform', objectId, purpose: 'creator_allocation' }, currency: 'usd', occurredAt: 1700000000,
  entries: [{ account: 'allocation:clearing', amount: 1000 }, { account: 'creator:fixture:payable', amount: -900 }, { account: 'platform:revenue', amount: -100 }],
  policy: { version: 'test-policy-not-live', commissionBps: 1000 }, ...overrides,
});
const transaction = overrides => ({ id: 'txn_one', object: 'balance_transaction', amount: 1000, fee: 59, net: 941,
  currency: 'usd', created: 1700000000, customer: 'PRIVATE_NOT_STORED', ...overrides });

test('ledger is disabled by default, rejects live mode and validates balanced integer journals', async () => {
  const disabled = await createLedger({ db }); await assert.rejects(disabled.post(journal()), { code: 'disabled' });
  await assert.rejects(createLedger({ db, mode: 'live' }), { code: 'mode' });
  for (const entries of [
    [{ account: 'a', amount: 1 }, { account: 'b', amount: -2 }],
    [{ account: 'a', amount: 0.1 }, { account: 'b', amount: -0.1 }],
    [{ account: 'a', amount: 0 }, { account: 'b', amount: 0 }],
    [{ account: 'a', amount: 1 }, { account: 'a', amount: -1 }],
    [{ account: 'a', amount: Number.MAX_SAFE_INTEGER }, { account: 'b', amount: -Number.MAX_SAFE_INTEGER }],
  ]) await assert.rejects(ledger.post(journal('invalid', { entries })));
  await assert.rejects(ledger.post({ ...journal(), untrustedPlayerBalance: 10000 }));
  await assert.rejects(ledger.post(journal('badcurrency', { currency: 'USD' })));
  assert.equal(await db.collection('paymentJournal').countDocuments(), 0);
});

test('same business source is atomically idempotent, line order is canonical, conflicting economics never overwrite', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => ledger.post(journal())));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  const id = results[0].id; const before = await db.collection('paymentJournal').findOne({ _id: id });
  assert.equal((await ledger.post(journal('invoice_one', { entries: [...journal().entries].reverse() }))).duplicate, true);
  await assert.rejects(ledger.post(journal('invoice_one', { policy: { version: 'different', commissionBps: 500 } })), { code: 'idempotency_conflict' });
  await assert.rejects(ledger.post(journal('invoice_one', { currency: 'eur' })), { code: 'idempotency_conflict' });
  assert.deepEqual(await db.collection('paymentJournal').findOne({ _id: id }), before);
  assert.equal(await db.collection('paymentJournal').countDocuments(), 1);
});

test('full reversal appends once under concurrency and preserves the original and its policy snapshot', async () => {
  const { id } = await ledger.post(journal()); const before = await db.collection('paymentJournal').findOne({ _id: id });
  const results = await Promise.all(Array.from({ length: 6 }, () => ledger.reverse({ journalId: id, reasonCode: 'accounting_correction' })));
  assert.equal(results.filter(result => !result.duplicate).length, 1); assert.equal(await db.collection('paymentJournal').countDocuments(), 2);
  assert.deepEqual(await db.collection('paymentJournal').findOne({ _id: id }), before);
  const reversal = await db.collection('paymentJournal').findOne({ reversalOf: id });
  assert.deepEqual(reversal.policy, before.policy);
  await assert.rejects(ledger.reverse({ journalId: results[0].id, reasonCode: 'accounting_correction' }), { code: 'invalid_reversal' });
  await assert.rejects(ledger.reverse({ journalId: id, reasonCode: 'test_reversal' }), { code: 'idempotency_conflict' });
  const balance = await ledger.trialBalance(); assert.ok(balance.accounts.every(account => account.amount === '0'));
  assert.equal((await ledger.compare(journal())).reversed, true);
});

test('currency totals stay separate and sum exactly beyond JavaScript safe integer aggregate range', async () => {
  // Direct fixture loading stresses report precision; each individual document
  // remains within the posting bound. There is no production bulk bypass API.
  const amount = 1_000_000_000_000, count = 9100;
  await db.collection('paymentJournal').insertMany(Array.from({ length: count }, (_, i) => ({ _id: `fixture-${i}`, mode: 'test', currency: 'usd',
    entries: [{ account: 'a', amount }, { account: 'b', amount: -amount }] })));
  await ledger.post(journal('eur_allocation', { currency: 'eur' }));
  const report = await ledger.trialBalance();
  assert.equal(report.accounts.find(row => row.currency === 'usd' && row.account === 'a').amount, '9100000000000000');
  assert.deepEqual(report.currencies.map(row => [row.currency, row.total, row.balanced]), [['eur', '0', true], ['usd', '0', true]]);
});

test('Stripe processor journal uses actual net and fees without estimating revenue or creator share', async () => {
  const input = stripeBalanceJournal({ transaction: transaction(), scope: 'platform' });
  assert.equal(JSON.stringify(input).includes('PRIVATE_NOT_STORED'), false);
  assert.deepEqual(input.entries, [
    { account: 'stripe:platform:balance', amount: 941 }, { account: 'stripe:platform:fees', amount: 59 }, { account: 'stripe:platform:unallocated', amount: -1000 },
  ]);
  assert.equal((await ledger.compare(input)).status, 'missing'); await ledger.post(input);
  assert.equal((await ledger.compare(input)).status, 'matched');
  const changed = stripeBalanceJournal({ transaction: transaction({ fee: 60, net: 940 }), scope: 'platform' });
  assert.equal((await ledger.compare(changed)).status, 'mismatch');
  await assert.rejects(ledger.post(changed), { code: 'idempotency_conflict' });
  assert.throws(() => stripeBalanceJournal({ transaction: transaction({ net: 999 }), scope: 'platform' }), { code: 'provider_mismatch' });
  assert.throws(() => stripeBalanceJournal({ transaction: transaction({ amount: 0, fee: 0, net: 0 }), scope: 'platform' }), { code: 'no_effect' });
  // Refund/debit and negative-fee adjustment directions retain signed amounts.
  const refund = stripeBalanceJournal({ transaction: transaction({ id: 'txn_refund', amount: -500, fee: 0, net: -500 }), scope: 'platform' });
  await ledger.post(refund); assert.equal((await ledger.trialBalance()).currencies[0].balanced, true);
  const connected = stripeBalanceJournal({ transaction: transaction(), scope: 'acct_other' });
  assert.notEqual((await ledger.post(connected)).id, (await ledger.post(input)).id);
});

test('failed insertion has no partial lines and a later retry inserts one complete journal', async () => {
  const collection = db.collection('paymentJournal'), realInsert = collection.insertOne.bind(collection); let failed = false;
  collection.insertOne = async (...args) => { if (!failed) { failed = true; throw new Error('storage unavailable'); } return realInsert(...args); };
  const failing = await createLedger({ db: { collection: () => collection }, mode: 'test' });
  await assert.rejects(failing.post(journal())); assert.equal(await collection.countDocuments(), 0);
  await failing.post(journal()); assert.equal(await collection.countDocuments(), 1);
  assert.equal((await collection.findOne()).entries.length, 3);
});
