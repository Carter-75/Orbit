import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createInvitations } from '../src/invitations.js';

test('game invitations recheck live rooms, friendship, ownership, expiry, blocks and single acceptance', async () => {
  const mongo = await MongoMemoryServer.create(); const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('invites'); const sender = randomUUID(), recipient = randomUUID(), stranger = randomUUID(), roomId = randomUUID(), projectId = randomUUID(), versionId = randomUUID();
    const grantId = randomBytes(32).toString('hex'); const origin = 'http://localhost:3000'; let sessionActive = true;
    await db.collection('users').insertMany([sender, recipient, stranger].map(_id => ({ _id, username: _id === sender ? 'Sender' : 'Player', emailVerified: true, ageBand: 'teen', authVersion: 0 })));
    await db.collection('projects').insertOne({ _id: projectId, ownerId: stranger, title: 'Game', status: 'published', publishedVersion: versionId });
    await db.collection('versions').insertOne({ _id: versionId, projectId, status: 'approved', manifest: { capabilities: ['multiplayer'] } });
    await db.collection('launchGrants').insertOne({ _id: grantId, projectId, versionId, userId: sender, authVersion: 0, preview: false, expiresAt: new Date(Date.now() + 60000) });
    const room = { id: roomId, projectId, versionId, preview: false, capacity: 2, members: new Map([[sender, { cookie: sender, grantId, ws: { readyState: 1 } }]]) };
    const rooms = new Map([[roomId, room]]);
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = req.get('test-user') ? { _id: req.get('test-user') } : null; next(); });
    const auth = { requireUser: (req, res, next) => req.user ? next() : res.sendStatus(401), resolveSession: async () => sessionActive ? db.collection('users').findOne({ _id: sender, suspended: { $ne: true } }) : null };
    app.use(await createInvitations({ db, config: { appOrigin: origin }, auth, getRooms: () => rooms }));
    const post = (path, body = {}, user = sender) => request(app).post(path).set('test-user', user).set('Origin', origin).send(body);
    const list = (user = recipient) => request(app).get('/').set('test-user', user);
    const send = () => post('/', { recipientId: recipient, roomId });
    assert.equal((await request(app).get('/')).status, 401);
    assert.equal((await request(app).post('/').set('test-user', sender).send({ recipientId: recipient, roomId })).status, 403);
    assert.equal((await send()).status, 404); // Not friends.
    await db.collection('socialPairs').insertOne({ _id: 'pair', members: [sender, recipient], status: 'accepted', blockedBy: [] });
    const first = await send(); assert.equal(first.status, 201); const id = first.body.invitation.id;
    const pending = await list(); assert.equal(pending.body.invitations[0].senderName, 'Sender'); assert.equal(pending.text.includes(grantId), false); assert.equal(pending.text.includes(roomId), false);
    assert.equal((await list(stranger)).body.invitations.length, 0);
    assert.equal((await post(`/${id}/accept`, {}, stranger)).status, 404);
    const accepted = await Promise.all([post(`/${id}/accept`, {}, recipient), post(`/${id}/accept`, {}, recipient)]);
    assert.equal(accepted.filter(result => result.status === 200).length, 1); assert.ok(accepted.some(result => [404, 409].includes(result.status)));
    assert.equal(accepted.find(result => result.status === 200).body.roomId, roomId);
    const second = (await send()).body.invitation.id;
    await db.collection('socialPairs').updateOne({ _id: 'pair' }, { $set: { blockedBy: [recipient] } });
    assert.equal((await list()).body.invitations.length, 0); assert.equal((await post(`/${second}/accept`, {}, recipient)).status, 404);
    await db.collection('socialPairs').updateOne({ _id: 'pair' }, { $set: { blockedBy: [] } });
    await db.collection('users').updateOne({ _id: recipient }, { $set: { adultAt: new Date(Date.now() - 1) } });
    assert.equal((await list()).body.invitations.length, 0);
    await db.collection('users').updateOne({ _id: recipient }, { $unset: { adultAt: '' } });
    sessionActive = false; assert.equal((await list()).body.invitations.length, 0); sessionActive = true;
    room.preview = true; assert.equal((await send()).status, 404); room.preview = false;
    room.capacity = 1; assert.equal((await list()).body.invitations.length, 0); room.capacity = 2;
    await db.collection('gameInvitations').updateOne({ _id: second }, { $set: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await post(`/${second}/accept`, {}, recipient)).status, 404);
    const third = (await send()).body.invitation.id;
    rooms.clear(); assert.equal((await post(`/${third}/accept`, {}, recipient)).status, 404);
    rooms.set(roomId, room);
    assert.equal((await post(`/${third}/decline`, {}, recipient)).status, 200); assert.equal((await list()).body.invitations.length, 0);
  } finally { await client.close(); await mongo.stop(); }
});
