import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recoverAdminPasskeys } from '../src/admin-recovery.js';
import { createAuth } from '../src/auth.js';
import { adminMfaActive } from '../src/admin-passkeys.js';

let mongo, client, db, auth;
before(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('admin-recovery');
  auth = await createAuth({ db, config: { appOrigin: 'http://localhost:3000' } });
});
after(async () => { await client?.close(); await mongo?.stop(); });
async function account(extra = {}) {
  const id = randomUUID(); const user = { _id: id, username: id, usernameKey: id, emailKey: `${id}@example.test`,
    role: 'admin', emailVerified: true, ageBand: 'adult', authVersion: 0, adminPasskeys: [{ id: randomUUID(), counter: 0 }], ...extra };
  await db.collection('users').insertOne(user); return user;
}
const input = user => ({ userId: user._id, operator: 'operator.test', caseReference: 'REC-100', reason: 'Owner identity verified outside the application' });
const apply = user => ({ ...input(user), apply: true, confirmation: user._id });

test('preview and confirmed recovery atomically remove keys and role, invalidate sessions and keep a minimal audit', async () => {
  const user = await account(), token = randomBytes(32).toString('base64url'), sessionId = createHash('sha256').update(token).digest('hex');
  await db.collection('sessions').insertOne({ _id: sessionId, userId: user._id, authVersion: 0, expiresAt: new Date(Date.now() + 60000),
    adminVerifiedUntil: new Date(Date.now() + 60000), adminVerifiedCredentialId: user.adminPasskeys[0].id });
  const req = { user, authSessionId: sessionId };
  assert.equal(await adminMfaActive(db, req), true);
  assert.equal((await recoverAdminPasskeys(db, input(user))).status, 'preview');
  assert.equal(await adminMfaActive(db, req), true);
  await assert.rejects(recoverAdminPasskeys(db, { ...apply(user), confirmation: randomUUID() }), /Confirmation/);
  const result = await recoverAdminPasskeys(db, apply(user)); assert.equal(result.status, 'recovered');
  assert.equal(await adminMfaActive(db, req), false); assert.equal(await auth.resolveSession(`orbit_session=${token}`), null);
  const stored = await db.collection('users').findOne({ _id: user._id });
  assert.equal(stored.role, 'player'); assert.equal(stored.adminPasskeys, undefined); assert.equal(stored.authVersion, 1);
  assert.equal(stored.privilegeHistory.length, 1); assert.equal(stored.privilegeHistory[0].operator, 'operator.test');
  assert.equal(stored.privilegeHistory[0].caseReference, 'REC-100'); assert.equal(JSON.stringify(stored.privilegeHistory).includes(user.adminPasskeys[0].id), false);
  assert.equal((await recoverAdminPasskeys(db, apply(user))).status, 'already_recovered');
});

test('suspended accounts remain suspended, concurrent recovery records once, and invalid requests cannot mutate', async () => {
  const user = await account({ suspended: true, emailVerified: false });
  for (const invalid of [{ ...apply(user), operator: '' }, { ...apply(user), caseReference: '\n' }, { ...apply(user), reason: 'short' }]) {
    await assert.rejects(recoverAdminPasskeys(db, invalid));
  }
  const results = await Promise.allSettled([recoverAdminPasskeys(db, apply(user)), recoverAdminPasskeys(db, apply(user))]);
  assert.ok(results.some(r => r.status === 'fulfilled' && r.value.status === 'recovered'));
  const stored = await db.collection('users').findOne({ _id: user._id });
  assert.equal(stored.suspended, true); assert.equal(stored.emailVerified, false); assert.equal(stored.authVersion, 1); assert.equal(stored.privilegeHistory.length, 1);
});

test('write failure preserves credentials, role and session version together', async () => {
  const user = await account();
  await db.command({ collMod: 'users', validator: { role: { $ne: 'player' } }, validationLevel: 'strict' });
  try { await assert.rejects(recoverAdminPasskeys(db, apply(user))); }
  finally { await db.command({ collMod: 'users', validator: {} }); }
  const stored = await db.collection('users').findOne({ _id: user._id });
  assert.deepEqual(stored, user);
});

test('operator CLI previews then applies without printing database secrets', async () => {
  const user = await account(); const run = promisify(execFile);
  const env = { ...process.env, MONGODB_URI: mongo.getUri(), MONGODB_DATABASE: db.databaseName };
  const args = ['scripts/recover-admin.js', '--user', user._id, '--operator', 'operator.test', '--case', 'REC-101', '--reason', 'Owner identity verified independently'];
  assert.equal(JSON.parse((await run(process.execPath, args, { env })).stdout).status, 'preview');
  const result = await run(process.execPath, [...args, '--apply', '--confirm', user._id], { env });
  assert.equal(JSON.parse(result.stdout).status, 'recovered'); assert.equal(result.stdout.includes(env.MONGODB_URI), false);
  await assert.rejects(run(process.execPath, args, { env: { ...env, MONGODB_URI: 'invalid-secret-uri' } }), error => {
    assert.equal(error.stderr.includes('invalid-secret-uri'), false); return true;
  });
});

test('a credential enrolled after inspection causes a recovery conflict without removing unseen keys', async () => {
  const user = await account(), extra = { id: randomUUID(), counter: 0 }, collection = db.collection('users');
  const racingDb = { collection: () => ({
    findOne: (...args) => collection.findOne(...args),
    updateOne: async (...args) => {
      await collection.updateOne({ _id: user._id }, { $push: { adminPasskeys: extra } });
      return collection.updateOne(...args);
    },
  }) };
  await assert.rejects(recoverAdminPasskeys(racingDb, apply(user)), /changed during recovery/);
  const stored = await collection.findOne({ _id: user._id });
  assert.equal(stored.role, 'admin'); assert.equal(stored.authVersion, 0); assert.equal(stored.privilegeHistory, undefined);
  assert.deepEqual(stored.adminPasskeys, [...user.adminPasskeys, extra]);
});
