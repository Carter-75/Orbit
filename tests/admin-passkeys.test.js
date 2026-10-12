import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createAuth, hashPassword } from '../src/auth.js';
import { createAdminPasskeys, adminMfaActive } from '../src/admin-passkeys.js';
import { testAuthenticator } from './fixtures/passkey-authenticator.js';

let mongo, client, db, app, passwordHash;
const origin = 'https://orbit.example.test', password = 'A strong passkey setup test password!';
before(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('passkey-tests');
  const config = { appOrigin: origin }, auth = await createAuth({ db, config }); passwordHash = await hashPassword(password);
  app = express(); app.use(express.json({ limit: '32kb' }), auth.authenticate);
  app.use('/passkeys', await createAdminPasskeys({ db, config, auth }));
});
after(async () => { await client?.close(); await mongo?.stop(); });
async function session(userId, authVersion = 0) {
  const token = randomBytes(32).toString('base64url'), sessionId = createHash('sha256').update(token).digest('hex');
  await db.collection('sessions').insertOne({ _id: sessionId, userId, authVersion, expiresAt: new Date(Date.now() + 3600000) });
  return { sessionId, cookie: `orbit_session=${token}` };
}
async function account(overrides = {}) {
  const id = randomUUID(); const user = { _id: id, username: `Admin_${id}`, usernameKey: id, emailKey: `${id}@example.test`,
    passwordHash, authVersion: 0, role: 'admin', emailVerified: true, ageBand: 'adult', ...overrides };
  await db.collection('users').insertOne(user); return { user, ...await session(id) };
}
const post = (actor, path, body = {}) => request(app).post(`/passkeys/${path}`).set('Origin', origin).set('Cookie', actor.cookie).send(body);
async function enroll(actor, device = testAuthenticator()) {
  const options = await post(actor, 'register/options', { password }); assert.equal(options.status, 200, JSON.stringify(options.body));
  assert.equal(options.body.options.authenticatorSelection.userVerification, 'required');
  const registered = await post(actor, 'register/verify', { challengeId: options.body.challengeId, response: device.register(options.body.options, origin) });
  assert.equal(registered.status, 200, JSON.stringify(registered.body)); return device;
}
const active = actor => adminMfaActive(db, { user: actor.user, authSessionId: actor.sessionId });

test('real cryptographic registration and assertion grant a session-only, expiring admin step-up', async () => {
  const actor = await account(), device = await enroll(actor);
  assert.equal(await active(actor), false);
  const other = { ...actor, ...await session(actor.user._id) };
  const options = await post(actor, 'authenticate/options');
  const response = device.authenticate(options.body.options, origin);
  const verified = await post(actor, 'authenticate/verify', { challengeId: options.body.challengeId, response });
  assert.equal(verified.status, 200, JSON.stringify(verified.body)); assert.equal(await active(actor), true); assert.equal(await active(other), false);
  assert.equal((await post(actor, 'authenticate/verify', { challengeId: options.body.challengeId, response })).status, 409);
  const stored = await db.collection('users').findOne({ _id: actor.user._id });
  assert.equal(stored.adminPasskeys[0].counter, 1); assert.equal(stored.privilegeHistory[0].action, 'register_admin_passkey');
  await db.collection('sessions').updateOne({ _id: actor.sessionId }, { $set: { adminVerifiedUntil: new Date(0) } });
  assert.equal(await active(actor), false);
});

test('admin/session/origin/password gates protect enrollment and challenges cannot cross sessions', async () => {
  const actor = await account(), player = await account({ role: 'player' });
  assert.equal((await request(app).get('/passkeys')).status, 401);
  assert.equal((await post(player, 'register/options', { password })).status, 403);
  assert.equal((await request(app).post('/passkeys/register/options').set('Cookie', actor.cookie).set('Origin', 'https://evil.example').send({ password })).status, 403);
  assert.equal((await post(actor, 'register/options', { password: 'wrong password' })).status, 401);
  const options = await post(actor, 'register/options', { password }), device = testAuthenticator();
  const body = { challengeId: options.body.challengeId, response: device.register(options.body.options, origin) };
  const other = { ...actor, ...await session(actor.user._id) };
  assert.equal((await post(other, 'register/verify', body)).status, 409);
  await db.collection('sessions').updateOne({ _id: actor.sessionId }, { $set: { 'adminChallenge.expiresAt': new Date(0) } });
  assert.equal((await post(actor, 'register/verify', body)).status, 409);
  await enroll(actor);
  assert.equal((await post(actor, 'register/options', { password })).status, 403);
});

test('real verifier rejects wrong origin, RP, challenge, missing user verification and invalid signatures', async () => {
  for (const variant of ['origin', 'rp', 'challenge', 'verification', 'signature']) {
    const actor = await account(), device = await enroll(actor);
    const options = await post(actor, 'authenticate/options');
    const response = device.authenticate(options.body.options, variant === 'origin' ? 'https://evil.example' : origin,
      variant === 'rp' ? { rpID: 'evil.example' } : variant === 'challenge' ? { challenge: 'wrong' } : variant === 'verification' ? { verified: false } : {});
    if (variant === 'signature') response.response.signature = randomBytes(72).toString('base64url');
    const result = await post(actor, 'authenticate/verify', { challengeId: options.body.challengeId, response });
    assert.equal(result.status, 400, variant); assert.equal(await active(actor), false);
    assert.equal((await post(actor, 'authenticate/verify', { challengeId: options.body.challengeId, response })).status, 409);
  }
});

test('expired sessions, account revocation and reused assertion counters cannot retain step-up', async () => {
  const actor = await account(), device = await enroll(actor);
  const options = await post(actor, 'authenticate/options');
  const response = device.authenticate(options.body.options, origin);
  await db.collection('users').updateOne({ _id: actor.user._id }, { $set: { 'adminPasskeys.0.counter': 1 } });
  assert.equal((await post(actor, 'authenticate/verify', { challengeId: options.body.challengeId, response })).status, 400);
  const fresh = await post(actor, 'authenticate/options');
  assert.equal((await post(actor, 'authenticate/verify', { challengeId: fresh.body.challengeId, response: device.authenticate(fresh.body.options, origin) })).status, 200);
  assert.equal(await active(actor), true);
  await db.collection('sessions').updateOne({ _id: actor.sessionId }, { $set: { expiresAt: new Date(0) } });
  assert.equal(await active(actor), false);
  await db.collection('sessions').updateOne({ _id: actor.sessionId }, { $set: { expiresAt: new Date(Date.now() + 60000) } });
  assert.equal(await active(actor), true);
  await db.collection('users').updateOne({ _id: actor.user._id }, { $inc: { authVersion: 1 } });
  assert.equal(await active(actor), false);
  assert.equal((await post(actor, 'authenticate/options')).status, 401);
});

test('step-up requires its enrolled credential to remain present and credential IDs cannot move between accounts', async () => {
  const actor = await account(), device = await enroll(actor), other = await account();
  const otherOptions = await post(other, 'register/options', { password });
  assert.equal((await post(other, 'register/verify', { challengeId: otherOptions.body.challengeId, response: device.register(otherOptions.body.options, origin) })).status, 409);
  const options = await post(actor, 'authenticate/options');
  assert.equal((await post(actor, 'authenticate/verify', { challengeId: options.body.challengeId, response: device.authenticate(options.body.options, origin) })).status, 200);
  assert.equal(await active(actor), true);
  await db.collection('users').updateOne({ _id: actor.user._id }, { $unset: { adminPasskeys: '' } });
  assert.equal(await active(actor), false);
});
