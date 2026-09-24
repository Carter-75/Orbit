import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createLibrary } from '../src/library.js';
import { recordLaunch, readAnalytics } from '../src/analytics.js';
import { createProjects } from '../src/projects.js';
import { createLaunch } from '../src/launch.js';

test('saved games are private, idempotent, visibility filtered and atomically bounded', async () => {
  const mongo = await MongoMemoryServer.create(); const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('library'); const alice = randomUUID(), bob = randomUUID(), game = randomUUID(), draft = randomUUID();
    await db.collection('users').insertMany([{ _id: alice }, { _id: bob }]);
    await db.collection('projects').insertMany([{ _id: game, status: 'published', title: 'Public', internalSecret: 'private' }, { _id: draft, status: 'draft' }]);
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.get('test-user')) req.user = { _id: req.get('test-user') }; next(); });
    const origin = 'http://localhost:3000'; const auth = { requireUser: (req, res, next) => req.user ? next() : res.sendStatus(401) };
    app.use(createLibrary({ db, config: { appOrigin: origin }, auth }));
    const save = (projectId, saved = true, user = alice) => request(app).post('/favorites').set('Origin', origin).set('test-user', user).send({ projectId, saved });
    const list = (user = alice) => request(app).get('/favorites').set('test-user', user);
    assert.equal((await request(app).get('/favorites')).status, 401);
    assert.equal((await request(app).post('/favorites').set('test-user', alice).send({ projectId: game, saved: true })).status, 403);
    assert.equal((await save(draft)).status, 404);
    const results = await Promise.all(Array.from({ length: 5 }, () => save(game)));
    assert.ok(results.every(result => result.status === 200)); assert.deepEqual((await list()).body.ids, [game]);
    assert.deepEqual((await list(bob)).body.ids, []); assert.equal((await list()).text.includes('internalSecret'), false);
    await db.collection('projects').updateOne({ _id: game }, { $set: { status: 'suspended' } });
    assert.deepEqual((await list()).body.games, []); assert.equal((await save(game, false)).status, 200);
    const filler = Array.from({ length: 199 }, () => randomUUID()), extra = [randomUUID(), randomUUID()];
    await db.collection('users').updateOne({ _id: alice }, { $set: { favoriteIds: filler } });
    await db.collection('projects').insertMany(extra.map(_id => ({ _id, status: 'published' })));
    const race = await Promise.all(extra.map(id => save(id))); assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    const ids = (await list()).body.ids; assert.equal(ids.length, 200); assert.equal((await save(ids.at(-1))).status, 200);
  } finally { await client.close(); await mongo.stop(); }
});

test('analytics count issued public grants, exclude staff/previews, expose no identities and require project ownership', async () => {
  const mongo = await MongoMemoryServer.create(); const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('analytics'); const projectId = randomUUID(), ownerId = randomUUID(), outsider = randomUUID(), versionId = randomUUID();
    const now = new Date('2026-09-24T12:00:00Z');
    const base = { projectId, ownerId, user: { _id: outsider } };
    await Promise.all(Array.from({ length: 20 }, () => recordLaunch(db, base, now)));
    await recordLaunch(db, { ...base, preview: true }, now);
    await recordLaunch(db, { ...base, user: { _id: ownerId } }, now);
    await recordLaunch(db, { ...base, user: { _id: outsider, role: 'admin' } }, now);
    await recordLaunch(db, base, new Date('2026-08-01T12:00:00Z'));
    const result = await readAnalytics(db, projectId, now);
    assert.equal(result.total, 20); assert.equal(result.days.length, 30); assert.equal(result.days.at(-1).launchGrants, 20);
    const stored = await db.collection('gameMetrics').findOne({ _id: `${projectId}:2026-09-24` });
    assert.equal(JSON.stringify(stored).includes(outsider), false); assert.equal(stored.expiresAt.toISOString(), '2026-12-23T00:00:00.000Z');
    await db.collection('projects').insertOne({ _id: projectId, ownerId, status: 'published', publishedVersion: versionId });
    await db.collection('versions').insertOne({ _id: versionId, projectId, status: 'approved', manifest: { entry: 'index.html' } });
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { _id: req.get('test-user'), authVersion: 0 }; next(); });
    const auth = { requireUser: (_req, _res, next) => next() }, config = { appOrigin: 'http://localhost:3000', assetOrigin: 'http://localhost:3001' };
    app.use('/projects', await createProjects({ db, config, auth })); app.use('/games', await createLaunch({ db, config, auth }));
    assert.equal((await request(app).get(`/projects/${projectId}/analytics`).set('test-user', outsider)).status, 404);
    assert.equal((await request(app).get(`/projects/${projectId}/analytics`).set('test-user', ownerId)).status, 200);
    const before = (await readAnalytics(db, projectId)).total;
    const launch = await request(app).post(`/games/${projectId}/launch`).set('test-user', outsider).send({}); assert.equal(launch.status, 200);
    assert.equal((await readAnalytics(db, projectId)).total, before + 1);
    await request(app).post(`/games/${projectId}/launch`).set('test-user', ownerId).send({ preview: true, versionId });
    assert.equal((await readAnalytics(db, projectId)).total, before + 1);
  } finally { await client.close(); await mongo.stop(); }
});
