import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Binary } from 'mongodb';
import request from 'supertest';
import express from 'express';
import { createAssetApp } from '../src/assets.js';
import { createLaunch } from '../src/launch.js';

test('private game grant enforces ownership, expiry and suspension; assets cannot serve platform source', async () => {
  const mongo = await MongoMemoryServer.create(); const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('asset-test');
    const config = { appOrigin: 'http://localhost:3000', assetOrigin: 'http://localhost:3001' };
    const owner = { _id: 'creator', authVersion: 0 };
    await db.collection('users').insertOne(owner);
    await db.collection('projects').insertOne({ _id: 'project', ownerId: owner._id, status: 'draft' });
    await db.collection('versions').insertOne({ _id: 'build', projectId: 'project', status: 'ready', manifest: { entry: 'index.html' } });
    await db.collection('assets').insertOne({ versionId: 'build', path: 'index.html', content: new Binary(Buffer.from('<h1>A creator game</h1>')), mime: 'text/html' });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = req.get('Test-User') === 'intruder' ? { _id: 'intruder', authVersion: 0 } : owner; next(); });
    app.use(await createLaunch({ db, config, auth: { requireUser: (_req, _res, next) => next() } }));
    const denied = await request(app).post('/project/launch').set('Test-User', 'intruder').send({ preview: true, versionId: 'build' });
    assert.equal(denied.status, 403);
    assert.equal((await request(app).post('/project/launch').send({})).status, 404);
    const grant = await request(app).post('/project/launch').send({ preview: true, versionId: 'build' });
    assert.equal(grant.status, 200);
    const assets = createAssetApp({ db, config });
    const path = new URL(grant.body.url).pathname;
    const loaded = await request(assets).get(path);
    assert.equal(loaded.status, 200); assert.match(loaded.text, /creator game/);
    assert.match(loaded.headers['content-security-policy'], /sandbox allow-scripts;/);
    assert.equal(loaded.headers['content-security-policy'].includes('allow-same-origin'), false);
    assert.equal(loaded.headers['set-cookie'], undefined);
    for (const route of ['/src/auth.js', '/api/auth/me', '/index.html', path.replace('index.html', '../auth.js')]) {
      assert.equal((await request(assets).get(route)).status, 404);
    }
    await db.collection('launchGrants').updateMany({}, { $set: { expiresAt: new Date(0) } });
    assert.equal((await request(assets).get(path)).status, 404);
    const nextGrant = await request(app).post('/project/launch').send({ preview: true, versionId: 'build' });
    await db.collection('projects').updateOne({ _id: 'project' }, { $set: { status: 'suspended' } });
    assert.equal((await request(assets).get(new URL(nextGrant.body.url).pathname)).status, 404);
  } finally { await client.close(); await mongo.stop(); }
});
