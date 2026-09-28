import { createHash } from 'node:crypto';
import { z } from 'zod';

const token = z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/);
const scopeSchema = z.union([z.literal('platform'), z.string().regex(/^acct_[A-Za-z0-9]{1,128}$/)]);
const money = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const currencySchema = z.string().regex(/^[a-z]{3}$/);
const sourceSchema = z.object({ provider: z.enum(['stripe', 'orbit']), scope: scopeSchema, objectId: token,
  purpose: z.enum(['processor_movement', 'creator_allocation', 'refund_allocation', 'adjustment']) }).strict();
const journalSchema = z.object({ source: sourceSchema, currency: currencySchema,
  occurredAt: z.number().int().positive().max(8640000000000),
  entries: z.array(z.object({ account: token, amount: money.refine(value => value !== 0) }).strict()).min(2).max(20),
  policy: z.object({ version: token, commissionBps: z.number().int().min(0).max(10000).optional(),
    projectId: z.string().uuid().optional(), creatorId: z.string().uuid().optional() }).strict().optional(),
}).strict();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyFor = source => hash(['test', source.provider, source.scope, source.objectId, source.purpose]);
const fail = (code, message) => Object.assign(new Error(message), { code });
function integerDecimal(value) {
  // Decimal128 may format a whole-number total in scientific notation. Expand
  // it with BigInt rather than passing through imprecise JavaScript numbers.
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i.exec(value.toString());
  if (!match) throw fail('invalid_total', 'Ledger contains invalid accounting data.');
  const fraction = match[3] || '', exponent = Number(match[4] || 0) - fraction.length;
  if (Math.abs(exponent) > 40) throw fail('invalid_total', 'Ledger total is outside the supported reporting range.');
  let amount = BigInt(match[2] + fraction);
  if (exponent >= 0) amount *= 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    if (amount % divisor !== 0n) throw fail('invalid_total', 'Ledger contains non-integer accounting data.');
    amount /= divisor;
  }
  return match[1] ? -amount : amount;
}
function normalize(input) {
  const value = journalSchema.parse(input);
  const accounts = new Set(); let sum = 0n;
  for (const entry of value.entries) {
    if (accounts.has(entry.account)) throw fail('duplicate_account', 'Combine repeated account lines before posting.');
    accounts.add(entry.account); sum += BigInt(entry.amount);
  }
  if (sum !== 0n) throw fail('unbalanced', 'Journal entries must sum to zero.');
  value.entries.sort((a, b) => a.account < b.account ? -1 : a.account > b.account ? 1 : 0);
  return value;
}

/** Internal test-mode accounting only; never expose posting methods to games.
 * A single insert contains every line. There is no journal update/delete API. */
export async function createLedger({ db, mode = 'disabled' }) {
  if (!['disabled', 'test'].includes(mode)) throw fail('mode', 'Live ledger activation is not implemented.');
  const journals = db.collection('paymentJournal');
  await Promise.all([
    journals.createIndex({ mode: 1, createdAt: -1 }),
    journals.createIndex({ mode: 1, currency: 1, 'entries.account': 1 }),
    journals.createIndex({ reversalOf: 1 }, { unique: true, partialFilterExpression: { reversalOf: { $type: 'string' } } }),
  ]);
  const writable = () => { if (mode !== 'test') throw fail('disabled', 'Ledger posting is disabled.'); };
  async function insert(value, id) {
    writable();
    const fingerprint = hash(value), document = { _id: id, mode: 'test', ...value, fingerprint, createdAt: new Date() };
    try { await journals.insertOne(document, { writeConcern: { w: 'majority' } }); return { id, duplicate: false }; }
    catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await journals.findOne({ _id: id, mode: 'test' });
      if (!existing || existing.fingerprint !== fingerprint) throw fail('idempotency_conflict', 'This financial source already has different accounting data. Investigate; do not overwrite it.');
      return { id, duplicate: true };
    }
  }
  async function post(input) {
    writable(); const value = normalize(input); return insert(value, keyFor(value.source));
  }
  async function reverse({ journalId, reasonCode }) {
    writable();
    if (!/^[a-f0-9]{64}$/.test(journalId || '') || !['accounting_correction', 'test_reversal'].includes(reasonCode)) throw fail('invalid_reversal', 'Provide a journal and a supported accounting reason.');
    const original = await journals.findOne({ _id: journalId, mode: 'test' });
    if (!original || original.reversalOf) throw fail('invalid_reversal', 'Only an original journal can be reversed.');
    const { source, currency, occurredAt, entries, policy } = normalize({ source: original.source, currency: original.currency,
      occurredAt: original.occurredAt, entries: original.entries, ...(original.policy ? { policy: original.policy } : {}) });
    // One full reversal per original, with a deterministic identity. It does not
    // call a provider refund or undo money movement outside this ledger.
    return insert({ source: { provider: 'orbit', scope: source.scope, objectId: journalId, purpose: 'reversal' },
      currency, occurredAt, entries: entries.map(entry => ({ ...entry, amount: -entry.amount })),
      ...(policy ? { policy } : {}), reversalOf: journalId, reasonCode }, hash(['test', 'reversal', journalId]));
  }
  async function trialBalance() {
    const rows = await journals.aggregate([
      { $match: { mode: 'test' } }, { $unwind: '$entries' },
      { $group: { _id: { currency: '$currency', account: '$entries.account' }, amount: { $sum: { $toDecimal: '$entries.amount' } } } },
      { $sort: { '_id.currency': 1, '_id.account': 1 } },
      { $limit: 10001 },
    ], { maxTimeMS: 5000 }).toArray();
    if (rows.length > 10000) throw fail('report_too_large', 'Partition the ledger report before reading more than 10,000 account/currency totals.');
    const totals = new Map();
    const accounts = rows.map(row => {
      const amount = integerDecimal(row.amount);
      totals.set(row._id.currency, (totals.get(row._id.currency) || 0n) + amount);
      return { ...row._id, amount: amount.toString() };
    });
    return { mode: 'test', accounts, currencies: [...totals].map(([currency, total]) => ({ currency, total: total.toString(), balanced: total === 0n })),
      notice: 'Signed minor-unit accounting totals only. Not cash availability, verified revenue, creator earnings or an amount eligible for payout.' };
  }
  async function compare(input) {
    const value = normalize(input), id = keyFor(value.source);
    const existing = await journals.findOne({ _id: id, mode: 'test' });
    const reversal = existing && await journals.findOne({ reversalOf: id, mode: 'test' }, { projection: { _id: 1 } });
    return { id, status: !existing ? 'missing' : existing.fingerprint === hash(value) ? 'matched' : 'mismatch', reversed: Boolean(reversal) };
  }
  return { post, reverse, trialBalance, compare };
}

/** Build an unallocated processor journal from a server-retrieved Stripe balance
 * transaction. The caller must establish account/test-mode provenance first. */
export function stripeBalanceJournal({ transaction, scope }) {
  scopeSchema.parse(scope);
  const value = z.object({ id: z.string().regex(/^txn_[A-Za-z0-9]{1,128}$/), object: z.literal('balance_transaction'),
    amount: money, fee: money, net: money, currency: currencySchema,
    created: z.number().int().positive().max(8640000000000) }).parse(transaction);
  if (BigInt(value.amount) - BigInt(value.fee) !== BigInt(value.net)) throw fail('provider_mismatch', 'Provider net does not equal gross less fees.');
  const entries = [
    { account: `stripe:${scope}:balance`, amount: value.net },
    { account: `stripe:${scope}:fees`, amount: value.fee },
    { account: `stripe:${scope}:unallocated`, amount: -value.amount },
  ].filter(entry => entry.amount !== 0);
  // A zero-value record has no accounting effect and is handled by reconciliation,
  // not fabricated balanced entries. Caller must explicitly classify it.
  if (entries.length < 2) throw fail('no_effect', 'Zero-value balance transactions have no journal effect.');
  return normalize({ source: { provider: 'stripe', scope, objectId: value.id, purpose: 'processor_movement' },
    currency: value.currency, occurredAt: value.created, entries });
}
