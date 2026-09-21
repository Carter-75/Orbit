import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createSafety } from '../src/safety.js';
import { createAdmin } from '../src/admin.js';

test('reports and support enforce privacy, target visibility, origin, bounded input and atomic decisions', async () => {
  const mongo = await MongoMemoryServer.create(); const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('safety'); const alice = randomUUID(), bob = randomUUID(), moderator = randomUUID(), project = randomUUID(), draft = randomUUID();
    const origin = 'http://localhost:3000';
    await db.collection('users').insertMany([{ _id: alice }, { _id: bob }, { _id: moderator, role: 'admin', emailVerified: true }]);
    await db.collection('projects').insertMany([{ _id: project, status: 'published' }, { _id: draft, status: 'draft' }]);
    const app = express(); app.use(express.json());
    app.use(async (req, _res, next) => { req.user = await db.collection('users').findOne({ _id: req.get('test-user') || '' }); next(); });
    const auth = { requireUser: (req, res, next) => req.user ? next() : res.sendStatus(401) };
    app.use('/api/safety', await createSafety({ db, config: { appOrigin: origin }, auth }));
    app.use('/api/admin', await createAdmin({ db, config: { appOrigin: origin }, auth }));
    const post = (path, body, user = alice) => request(app).post(`/api${path}`).set('test-user', user).set('Origin', origin).send(body);
    const get = (path, user = alice) => request(app).get(`/api${path}`).set('test-user', user);
    const report = { kind: 'report', category: 'unsafe-content', targetType: 'project', targetId: project, message: 'Please review the content in this game.' };
    assert.equal((await request(app).get('/api/safety/cases')).status, 401);
    assert.equal((await request(app).post('/api/safety/cases').set('test-user', alice).send(report)).status, 403);
    assert.equal((await post('/safety/cases', { ...report, targetId: draft })).status, 404);
    assert.equal((await post('/safety/cases', { ...report, reporterId: bob })).status, 400);
    assert.equal((await post('/safety/cases', { ...report, message: 'x'.repeat(2001) })).status, 400);
    const created = await post('/safety/cases', report); assert.equal(created.status, 201);
    const id = created.body.case.id;
    assert.equal((await get('/safety/cases', bob)).body.cases.length, 0);
    assert.equal((await get('/safety/cases')).body.cases[0].id, id);
    assert.equal((await get('/admin/cases')).status, 403);
    const queue = await get('/admin/cases', moderator); assert.equal(queue.body.cases[0].id, id);
    const decision = { outcome: 'resolved', reason: 'PRIVATE INTERNAL INVESTIGATION DETAIL', publicReply: 'Thank you. We reviewed your report and took action.' };
    assert.equal((await post(`/admin/cases/${id}/resolve`, decision)).status, 403);
    const results = await Promise.all([post(`/admin/cases/${id}/resolve`, decision, moderator), post(`/admin/cases/${id}/resolve`, { ...decision, outcome: 'dismissed' }, moderator)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const stored = await db.collection('reports').findOne({ _id: id }); assert.equal(stored.moderationHistory.length, 1);
    const own = await get('/safety/cases'); assert.equal(own.body.cases[0].publicReply, decision.publicReply);
    assert.equal(own.text.includes('PRIVATE INTERNAL'), false); assert.equal(own.text.includes(moderator), false);
    assert.equal((await get('/admin/cases', moderator)).body.cases.length, 0);
    assert.equal((await post('/safety/cases', { kind: 'support', category: 'account', message: 'I need help with account settings.' })).status, 201);
    assert.equal((await post('/safety/cases', { kind: 'report', category: 'other', message: 'A report needs a target.' })).status, 400);
  } finally { await client.close(); await mongo.stop(); }
});
