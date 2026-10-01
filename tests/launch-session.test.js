import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Binary } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAssetApp } from '../src/assets.js';
import { readConfig } from '../src/config.js';
import { gameAccess } from '../src/game-access.js';

test('launch URLs and SDK grants end with their originating session without revoking another device', async () => {
  const mongo = await MongoMemoryServer.create(), client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('launch-session'), config = readConfig({ MONGODB_URI: mongo.getUri() });
    const { app } = await createApp({ db, config, sendMail: null }), assets = createAssetApp({ db, config });
    const a = request.agent(app), b = request.agent(app);
    const password = 'test session binding passphrase';
    const registration = await a.post('/api/auth/register').set('Origin', config.appOrigin).send({ username: 'SessionPlayer', email: 'session@example.test', password, dateOfBirth: '2000-01-01' });
    assert.equal(registration.status, 201); const userId = registration.body.user.id;
    assert.equal((await b.post('/api/auth/login').set('Origin', config.appOrigin).send({ identifier: 'SessionPlayer', password })).status, 200);
    await db.collection('projects').insertOne({ _id: 'game', ownerId: userId, status: 'published', publishedVersion: 'version' });
    await db.collection('versions').insertOne({ _id: 'version', projectId: 'game', status: 'approved', manifest: { entry: 'index.html', capabilities: ['storage'] } });
    await db.collection('assets').insertOne({ versionId: 'version', path: 'index.html', mime: 'text/html', content: new Binary(Buffer.from('<h1>Session test</h1>')) });
    const launch = async agent => { const response = await agent.post('/api/games/game/launch').set('Origin', config.appOrigin).send({}); assert.equal(response.status, 200); return response.body; };
    const asset = grant => request(assets).get(new URL(grant.url).pathname);
    const first = await launch(a), second = await launch(b);
    assert.equal((await asset(first)).status, 200); assert.equal((await asset(second)).status, 200);
    assert.equal((await a.post('/api/auth/logout').set('Origin', config.appOrigin).send({})).status, 200);
    assert.equal((await asset(first)).status, 404);
    assert.equal((await asset(second)).status, 200);
    assert.equal((await b.post('/api/sdk/storage').set('Origin', config.appOrigin).send({ grantId: first.grantId, operation: 'get' })).status, 403);
    assert.equal((await b.post('/api/sdk/storage').set('Origin', config.appOrigin).send({ grantId: second.grantId, operation: 'get' })).status, 200);
    const stored = await db.collection('launchGrants').findOne({ _id: second.grantId });
    assert.match(stored.sessionId, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(second).includes(stored.sessionId), false);
    // A pre-upgrade/unbound grant fails closed rather than falling back to user-only access.
    await db.collection('launchGrants').updateOne({ _id: second.grantId }, { $unset: { sessionId: '' } });
    assert.equal((await asset(second)).status, 404);
    await db.collection('launchGrants').updateOne({ _id: second.grantId }, { $set: { sessionId: stored.sessionId } });
    // Signing in again rotates this browser's session and revokes its previous launches.
    assert.equal((await b.post('/api/auth/login').set('Origin', config.appOrigin).send({ identifier: 'SessionPlayer', password })).status, 200);
    assert.equal((await asset(second)).status, 404);
    const current = await db.collection('sessions').findOne({ userId });
    const nearExpiry = new Date(Date.now() + 30000);
    await db.collection('sessions').updateOne({ _id: current._id }, { $set: { expiresAt: nearExpiry } });
    const third = await launch(b); assert.equal(new Date(third.expiresAt).getTime(), nearExpiry.getTime());
    await db.collection('sessions').updateOne({ _id: current._id }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await asset(third)).status, 404);
    assert.equal(await gameAccess(db, { _id: userId, authVersion: 0 }, third.grantId, 'storage'), null);
  } finally { await client.close(); await mongo.stop(); }
});
