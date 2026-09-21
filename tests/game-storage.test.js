import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createGameStorage } from '../src/game-storage.js';

test('SDK saves are player-scoped, capability-gated, bounded and preview-isolated', async () => {
  const mongo = await MongoMemoryServer.create(); const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('saves'); const grantId = 'a'.repeat(64), previewId = 'b'.repeat(64);
    const user = { _id: 'alice', authVersion: 0 };
    await db.collection('projects').insertOne({ _id: 'game', ownerId: 'alice', status: 'published' });
    await db.collection('versions').insertOne({ _id: 'v1', projectId: 'game', status: 'approved', manifest: { capabilities: ['storage'] } });
    for (const [id, preview] of [[grantId, false], [previewId, true]]) await db.collection('launchGrants').insertOne({
      _id: id, userId: 'alice', authVersion: 0, projectId: 'game', versionId: 'v1', preview, expiresAt: new Date(Date.now() + 60000),
    });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { ...user, _id: req.get('test-user') || 'alice' }; next(); });
    app.use(createGameStorage({ db, auth: { requireUser: (_req, _res, next) => next() } }));
    const send = body => request(app).post('/storage').send({ grantId, ...body });
    assert.equal((await send({ operation: 'get' })).body.value, null);
    const value = { level: 4, '$set': { coins: 5 }, nested: ['safe'] };
    assert.equal((await send({ operation: 'set', value })).status, 200);
    assert.deepEqual((await send({ operation: 'get' })).body.value, value);
    assert.equal((await send({ grantId: previewId, operation: 'get' })).body.value, null);
    assert.equal((await send({ operation: 'get' }).set('test-user', 'bob')).status, 403);
    assert.equal((await send({ operation: 'set', value: 'x'.repeat(8193) })).status, 413);
    assert.equal((await send({ operation: 'set' })).status, 400);
    await db.collection('versions').updateOne({ _id: 'v1' }, { $set: { 'manifest.capabilities': [] } });
    assert.equal((await send({ operation: 'get' })).status, 403);
    await db.collection('versions').updateOne({ _id: 'v1' }, { $set: { 'manifest.capabilities': ['storage'] } });
    await db.collection('projects').updateOne({ _id: 'game' }, { $set: { status: 'suspended' } });
    assert.equal((await send({ operation: 'get' })).status, 403);
  } finally { await client.close(); await mongo.stop(); }
});
