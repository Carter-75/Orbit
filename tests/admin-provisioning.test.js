import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { provisionAdmin } from '../src/admin-provisioning.js';
import { createAuth } from '../src/auth.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let mongo, client, db, auth;
before(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('provisioning-tests');
  auth = await createAuth({ db, config: { appOrigin: 'http://localhost:3000', production: false } });
});
after(async () => { await client?.close(); await mongo?.stop(); });
async function account(overrides = {}) {
  const id = randomUUID();
  await db.collection('users').insertOne({ _id: id, username: id, usernameKey: id,
    emailKey: `${id}@example.test`, role: 'player', ageBand: 'adult', emailVerified: true, authVersion: 0, ...overrides });
  return id;
}
const input = userId => ({ userId, reason: 'Owner approved moderator access' });

test('operator CLI previews and applies against the selected database without emitting secrets', async () => {
  const userId = await account();
  const env = { ...process.env, MONGODB_URI: mongo.getUri(), MONGODB_DATABASE: db.databaseName };
  const args = ['scripts/provision-admin.js', '--user', userId, '--reason', 'Owner approved moderator access'];
  const run = promisify(execFile);
  const preview = await run(process.execPath, args, { env });
  assert.equal(JSON.parse(preview.stdout).status, 'preview');
  assert.equal((await db.collection('users').findOne({ _id: userId })).role, 'player');
  const applied = await run(process.execPath, [...args, '--apply', '--confirm', userId], { env });
  assert.equal(JSON.parse(applied.stdout).status, 'granted');
  assert.equal(applied.stdout.includes(env.MONGODB_URI), false);
  await assert.rejects(run(process.execPath, args, { env: { ...env, MONGODB_URI: 'invalid-secret-database-uri' } }), error => {
    assert.equal(error.stderr.includes('invalid-secret-database-uri'), false);
    assert.match(error.stderr, /Set MONGODB_URI securely/); return true;
  });
});

test('provisioning previews without writes, requires exact confirmation, atomically grants and revokes old sessions', async () => {
  const userId = await account(); const token = randomBytes(32).toString('base64url');
  await db.collection('sessions').insertOne({ _id: createHash('sha256').update(token).digest('hex'), userId, authVersion: 0, expiresAt: new Date(Date.now() + 60000) });
  const cookie = `orbit_session=${token}`;
  assert.ok(await auth.resolveSession(cookie));
  assert.equal((await provisionAdmin(db, input(userId))).status, 'preview');
  assert.equal((await db.collection('users').findOne({ _id: userId })).role, 'player');
  await assert.rejects(provisionAdmin(db, { ...input(userId), apply: true, confirmation: randomUUID() }), /Confirmation/);
  const result = await provisionAdmin(db, { ...input(userId), apply: true, confirmation: userId });
  assert.equal(result.status, 'granted'); assert.equal(await auth.resolveSession(cookie), null);
  const user = await db.collection('users').findOne({ _id: userId });
  assert.equal(user.authVersion, 1); assert.equal(user.role, 'admin');
  assert.equal(user.privilegeHistory.length, 1); assert.equal(user.privilegeHistory[0].source, 'operator_cli');
  assert.equal((await provisionAdmin(db, { ...input(userId), apply: true, confirmation: userId })).status, 'already_admin');
  assert.equal((await db.collection('users').findOne({ _id: userId })).privilegeHistory.length, 1);
  for (const key of ['emailKey', 'privilegeHistory', 'authVersion']) assert.equal(key in result, false);
});

test('provisioning rejects missing, unverified, suspended, teen and malformed authorization accounts', async () => {
  await assert.rejects(provisionAdmin(db, input(randomUUID())), /not found/);
  for (const overrides of [{ emailVerified: false }, { suspended: true }, { ageBand: 'teen' }, { role: 'unknown' }, { authVersion: -1 }]) {
    const userId = await account(overrides);
    await assert.rejects(provisionAdmin(db, { ...input(userId), apply: true, confirmation: userId }));
    assert.equal((await db.collection('users').findOne({ _id: userId })).privilegeHistory, undefined);
  }
  await assert.rejects(provisionAdmin(db, { ...input(await account()), unexpected: true }));
});

test('concurrent grants write one audit event, and storage failure cannot partially elevate privileges', async () => {
  const userId = await account(), request = { ...input(userId), apply: true, confirmation: userId };
  const results = await Promise.allSettled([provisionAdmin(db, request), provisionAdmin(db, request)]);
  assert.ok(results.some(result => result.status === 'fulfilled' && result.value.status === 'granted'));
  const user = await db.collection('users').findOne({ _id: userId });
  assert.equal(user.authVersion, 1); assert.equal(user.privilegeHistory.length, 1);
  const failedId = await account();
  await db.command({ collMod: 'users', validator: { role: { $ne: 'admin' } }, validationLevel: 'strict' });
  try {
    await assert.rejects(provisionAdmin(db, { ...input(failedId), apply: true, confirmation: failedId }));
    const unchanged = await db.collection('users').findOne({ _id: failedId });
    assert.equal(unchanged.role, 'player'); assert.equal(unchanged.authVersion, 0); assert.equal(unchanged.privilegeHistory, undefined);
  } finally { await db.command({ collMod: 'users', validator: {} }); }
});
