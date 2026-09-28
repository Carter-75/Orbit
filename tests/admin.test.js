import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createAdmin } from '../src/admin.js';
import { createProjects } from '../src/projects.js';
import { createLedger } from '../src/ledger.js';

let mongo, client, db, app;
const admin = randomUUID(), owner = randomUUID(), unverified = randomUUID(), target = randomUUID();
const origin = 'http://localhost:3000', reason = 'Reviewed the submitted content and publishing requirements.';
const post = (path, body, user = admin) => request(app).post(`/api/admin${path}`).set('Origin', origin).set('X-Test-User', user).send(body);
before(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('admin-tests');
  await db.collection('users').insertMany([
    { _id: admin, role: 'admin', emailVerified: true, passwordHash: 'NEVER-EXPOSE', email: 'private@example.test' },
    { _id: owner, role: 'player', emailVerified: true }, { _id: unverified, role: 'admin', emailVerified: false },
    { _id: target, role: 'player', emailVerified: true, authVersion: 0, passwordHash: 'NEVER-EXPOSE' },
  ]);
  app = express(); app.use(express.json()); app.use(async (req, _res, next) => { req.user = await db.collection('users').findOne({ _id: req.get('X-Test-User') || '' }); next(); });
  const auth = { requireUser: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in.' }) };
  app.use('/api/admin', await createAdmin({ db, config: { appOrigin: origin }, auth }));
  app.use('/api/projects', await createProjects({ db, config: { appOrigin: origin }, auth }));
});
after(async () => { await client?.close(); await mongo?.stop(); });
async function pending() {
  const projectId = randomUUID(), versionId = randomUUID();
  await db.collection('projects').insertOne({ _id: projectId, ownerId: owner, title: 'Creator submission', status: 'review', publishedVersion: null });
  await db.collection('versions').insertOne({ _id: versionId, projectId, ownerId: owner, status: 'pending', manifest: { version: 1, title: 'Game' }, submittedAt: new Date(), internalSecret: 'NEVER-EXPOSE' });
  return { projectId, versionId };
}

test('ordinary creators cannot approve; verified current admin and exact origin required', async () => {
  const { versionId } = await pending();
  assert.equal((await request(app).get('/api/admin/queue')).status, 401);
  assert.equal((await post(`/versions/${versionId}/review`, { decision: 'approve', reason }, owner)).status, 403);
  assert.equal((await request(app).get('/api/admin/queue').set('X-Test-User', unverified)).status, 403);
  assert.equal((await request(app).post(`/api/admin/versions/${versionId}/review`).set('X-Test-User', admin).set('Origin', 'https://wrong.example').send({ decision: 'approve', reason })).status, 403);
  assert.equal((await post(`/versions/${versionId}/review`, { decision: 'approve', reason: 'short' })).status, 400);
  assert.equal((await db.collection('versions').findOne({ _id: versionId })).status, 'pending');
});

test('payment inbox is admin-only and excludes provider payloads, account mappings and leases', async () => {
  await db.collection('stripeEvents').insertOne({ _id: 'fixture-event', eventId: 'evt_one', type: 'invoice.paid', mode: 'test',
    status: 'awaiting_handler', attempts: 0, receivedAt: new Date(), account: 'acct_PRIVATE', leaseToken: 'NEVER-EXPOSE', data: { secret: 'NEVER-EXPOSE' } });
  assert.equal((await request(app).get('/api/admin/payment-events').set('X-Test-User', owner)).status, 403);
  const result = await request(app).get('/api/admin/payment-events').set('X-Test-User', admin);
  assert.equal(result.status, 200); assert.equal(result.body.counts.awaiting_handler, 1);
  assert.equal(result.body.events[0].eventId, 'evt_one'); assert.equal(result.text.includes('NEVER-EXPOSE'), false);
  assert.equal(result.text.includes('acct_PRIVATE'), false);
});

test('test ledger diagnostics require current verified admin and do not offer a posting endpoint', async () => {
  const ledger = await createLedger({ db, mode: 'test' });
  const entry = await ledger.post({ source: { provider: 'orbit', scope: 'platform', objectId: 'diagnostic', purpose: 'adjustment' },
    currency: 'usd', occurredAt: 1700000000, entries: [{ account: 'test:a', amount: 100 }, { account: 'test:b', amount: -100 }] });
  await db.collection('paymentJournal').updateOne({ _id: entry.id }, { $set: { internalSecret: 'NEVER-EXPOSE' } });
  assert.equal((await request(app).get('/api/admin/payment-ledger')).status, 401);
  assert.equal((await request(app).get('/api/admin/payment-ledger').set('X-Test-User', owner)).status, 403);
  assert.equal((await request(app).get('/api/admin/payment-ledger').set('X-Test-User', unverified)).status, 403);
  const response = await request(app).get('/api/admin/payment-ledger').set('X-Test-User', admin);
  assert.equal(response.status, 200); assert.equal(response.body.mode, 'test'); assert.equal(response.body.configuredMode, 'disabled');
  assert.equal(response.body.currencies[0].balanced, true); assert.equal(response.body.accounts[0].amount, '100');
  assert.equal(response.text.includes('NEVER-EXPOSE'), false); assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await post('/payment-ledger', { amount: 99999 })).status, 404);
});
test('queue projects minimal metadata, review is conditional and audit is atomic', async () => {
  const { versionId } = await pending();
  const queue = await request(app).get('/api/admin/queue').set('X-Test-User', admin);
  assert.equal(queue.status, 200); assert.equal(queue.body.versions.find(v => v.id === versionId).projectTitle, 'Creator submission');
  assert.ok(!queue.text.includes('NEVER-EXPOSE')); assert.ok(!queue.text.includes('private@example.test'));
  const decisions = await Promise.all([post(`/versions/${versionId}/review`, { decision: 'approve', reason }), post(`/versions/${versionId}/review`, { decision: 'reject', reason })]);
  assert.deepEqual(decisions.map(response => response.status).sort(), [200, 409]);
  const version = await db.collection('versions').findOne({ _id: versionId });
  assert.equal(version.moderationHistory.length, 1); assert.equal(version.moderationHistory[0].actorId, admin); assert.equal(version.moderationHistory[0].toStatus, version.status);
  assert.ok(decisions.every(response => !response.text.includes('NEVER-EXPOSE')));
});
test('project suspension blocks publishing; restoration returns draft without publication', async () => {
  const { projectId, versionId } = await pending();
  await post(`/versions/${versionId}/review`, { decision: 'approve', reason });
  const publish = () => request(app).post(`/api/projects/${projectId}/publish`).set('Origin', origin).set('X-Test-User', owner).send({ versionId });
  assert.equal((await publish()).status, 200);
  assert.equal((await post(`/projects/${projectId}/suspend`, { reason })).status, 200);
  let project = await db.collection('projects').findOne({ _id: projectId });
  assert.equal(project.previousStatus, 'published'); assert.equal(project.moderationHistory.length, 1);
  assert.equal((await publish()).status, 403);
  assert.equal((await post(`/projects/${projectId}/restore`, { reason })).status, 200);
  project = await db.collection('projects').findOne({ _id: projectId });
  assert.equal(project.status, 'draft'); assert.equal(project.publishedVersion, null); assert.equal(project.moderationHistory.length, 2);
  assert.equal((await post(`/projects/${projectId}/restore`, { reason })).status, 409);
});
test('account suspension invalidates auth version, records reason and prevents self suspension', async () => {
  assert.equal((await post(`/users/${admin}/suspend`, { reason })).status, 403);
  const suspended = await post(`/users/${target}/suspend`, { reason }); assert.equal(suspended.status, 200);
  assert.deepEqual(suspended.body, { user: { id: target, suspended: true } });
  const user = await db.collection('users').findOne({ _id: target }); assert.equal(user.authVersion, 1); assert.equal(user.moderationHistory[0].reason, reason);
  assert.equal((await post(`/users/${target}/suspend`, { reason })).status, 409);
  await db.collection('users').updateOne({ _id: admin }, { $set: { role: 'player' } });
  try { assert.equal((await request(app).get('/api/admin/queue').set('X-Test-User', admin)).status, 403); }
  finally { await db.collection('users').updateOne({ _id: admin }, { $set: { role: 'admin' } }); }
});
