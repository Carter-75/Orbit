import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { drainMailOutbox } from '../src/auth.js';
import { issueEnrollment, enrollmentAvailable, consumeEnrollment } from '../src/enrollment.js';
import { provisionAdmin } from '../src/admin-provisioning.js';
import { testAuthenticator } from './fixtures/passkey-authenticator.js';
import { grantSessionActive } from '../src/grant-session.js';
import { createHash } from 'node:crypto';

let mongo, client, db, app;
const origin = 'https://orbit.example.test', mail = [];
const sendMail = async value => mail.push(value);
const account = { username: 'PrivateOwner', email: 'owner@example.test', password: 'A long private test password!', dateOfBirth: '2000-01-01' };
const post = (path, body) => request(app).post(`/api/auth/${path}`).set('Origin', origin).send(body);
const issue = email => issueEnrollment(db, { email, apply: true, confirmation: email });
before(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('enrollment-tests');
  ({ app } = await createApp({ db, config: { appOrigin: origin, assetOrigin: 'https://games.example.test', production: true, publicLaunch: false }, sendMail }));
});
after(async () => { await client?.close(); await mongo?.stop(); });

test('closed production enrollment requires an email-bound invitation and still verifies email before owner elevation', async () => {
  assert.equal((await post('register', account)).status, 503);
  const invitation = await issue(account.email);
  assert.equal((await post('register', { ...account, email: 'someoneelse@example.test', invitationCode: invitation.code })).status, 503);
  assert.equal((await post('register', { ...account, dateOfBirth: '2025-01-01', invitationCode: invitation.code })).status, 400);
  assert.equal(await enrollmentAvailable(db, account.email, invitation.code), true);
  const registered = await post('register', { ...account, email: 'OWNER@example.test', invitationCode: invitation.code });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  assert.equal(registered.body.user.role, 'player'); assert.equal(registered.body.user.emailVerified, false);
  assert.equal(JSON.stringify(registered.body).includes(invitation.code), false);
  assert.equal((await post('register', { ...account, invitationCode: invitation.code })).status, 503);
  const userId = registered.body.user.id, cookie = registered.headers['set-cookie'].at(-1).split(';')[0];
  await assert.rejects(provisionAdmin(db, { userId, apply: true, confirmation: userId, reason: 'Owner setup approval' }), /verified/);
  await drainMailOutbox({ db, sendMail }); assert.equal(mail.length, 1);
  const secret = mail[0].text.match(/verify-email=([\w-]+)/)[1];
  const verified = await post('verify-email', { token: secret });
  assert.equal(verified.status, 200);
  assert.equal((await provisionAdmin(db, { userId, apply: true, confirmation: userId, reason: 'Owner setup approval' })).status, 'granted');
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.user, null);
  const login = await post('login', { identifier: account.email, password: account.password });
  assert.equal(login.status, 200); assert.equal(login.body.user.role, 'admin');
  const currentCookie = login.headers['set-cookie'].at(-1).split(';')[0];
  assert.equal((await request(app).get('/api/admin/queue').set('Cookie', currentCookie)).status, 403);
  const ceremony = (path, body) => request(app).post(`/api/account/admin-passkeys/${path}`).set('Cookie', currentCookie).set('Origin', origin).send(body);
  const device = testAuthenticator();
  const registration = await ceremony('register/options', { password: account.password });
  assert.equal(registration.status, 200, JSON.stringify(registration.body));
  assert.equal((await ceremony('register/verify', { challengeId: registration.body.challengeId, response: device.register(registration.body.options, origin) })).status, 200);
  assert.equal((await request(app).get('/api/admin/queue').set('Cookie', currentCookie)).status, 403);
  const projectId = randomUUID(), versionId = randomUUID();
  await db.collection('projects').insertOne({ _id: projectId, ownerId: randomUUID(), status: 'draft' });
  await db.collection('versions').insertOne({ _id: versionId, projectId, status: 'pending', manifest: { entry: 'index.html', capabilities: [] } });
  const launch = () => request(app).post(`/api/games/${projectId}/launch`).set('Cookie', currentCookie).set('Origin', origin).send({ preview: true, versionId });
  assert.equal((await launch()).status, 403);
  const assertion = await ceremony('authenticate/options', {});
  assert.equal((await ceremony('authenticate/verify', { challengeId: assertion.body.challengeId, response: device.authenticate(assertion.body.options, origin) })).status, 200);
  assert.equal((await request(app).get('/api/admin/queue').set('Cookie', currentCookie)).status, 200);
  const preview = await launch(); assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const grant = await db.collection('launchGrants').findOne({ _id: preview.body.grantId });
  assert.equal(grant.adminMfaRequired, true); assert.equal(await grantSessionActive(db, grant), true);
  const sessionId = createHash('sha256').update(currentCookie.split('=')[1]).digest('hex');
  await db.collection('sessions').updateOne({ _id: sessionId }, { $set: { adminVerifiedUntil: new Date(0) } });
  for (const route of ['queue', 'cases', 'payment-events', 'payment-ledger']) {
    assert.equal((await request(app).get(`/api/admin/${route}`).set('Cookie', currentCookie)).status, 403);
  }
  assert.equal((await launch()).status, 403); assert.equal(await grantSessionActive(db, grant), false);
  assert.equal((await request(app).get('/api/platform')).body.publicLaunch, false);
  await assert.rejects(issue(account.email), /already exists/);
});

test('invites are preview-first, expire synchronously, rotate on reissue, and are consumed only once', async () => {
  const email = 'tester@example.test';
  assert.equal((await issueEnrollment(db, { email })).status, 'preview');
  const count = await db.collection('enrollments').countDocuments();
  await assert.rejects(issueEnrollment(db, { email, apply: true, confirmation: 'other@example.test' }), /Confirm/);
  assert.equal(await db.collection('enrollments').countDocuments(), count);
  const first = await issue(email), second = await issue(email);
  assert.equal(await enrollmentAvailable(db, email, first.code), false);
  assert.equal(await enrollmentAvailable(db, email, second.code), true);
  const docs = await db.collection('enrollments').find({}).toArray();
  assert.equal(JSON.stringify(docs).includes(second.code), false); assert.equal(JSON.stringify(docs).includes(email), false);
  const results = await Promise.all([consumeEnrollment(db, email, second.code, randomUUID()), consumeEnrollment(db, email, second.code, randomUUID())]);
  assert.deepEqual(results.sort(), [false, true]);
  const expiring = await issue('expired@example.test');
  await db.collection('enrollments').updateMany({ status: 'ready' }, { $set: { expiresAt: new Date(0) } });
  assert.equal(await enrollmentAvailable(db, 'expired@example.test', expiring.code), false);
  assert.equal(await consumeEnrollment(db, 'expired@example.test', expiring.code, randomUUID()), false);
});

test('an insertion conflict burns the claimed code and a newly issued code permits recovery', async () => {
  const email = 'recovery@example.test', invitation = await issue(email);
  const conflict = await post('register', { ...account, email, invitationCode: invitation.code });
  assert.equal(conflict.status, 409);
  assert.equal(await enrollmentAvailable(db, email, invitation.code), false);
  assert.equal(await db.collection('users').findOne({ emailKey: email }), null);
  const replacement = await issue(email);
  const recovered = await post('register', { ...account, username: 'RecoveredTester', email, invitationCode: replacement.code });
  assert.equal(recovered.status, 201); assert.equal(recovered.body.user.emailVerified, false);
  assert.equal(recovered.body.user.role, 'player');
});
