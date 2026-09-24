import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createAuth } from '../src/auth.js';
import { createSocial } from '../src/social.js';

let mongo, client, db, app;
const origin = 'http://localhost:3000';
const cookies = {};
const accounts = [
  { _id: 'alice', username: 'Alice', ageBand: 'teen' },
  { _id: 'bobby', username: 'Bobby', ageBand: 'teen' },
  { _id: 'carol', username: 'Carol', ageBand: 'teen' },
  { _id: 'adult', username: 'Adult', ageBand: 'adult' },
];
const api = (actor, method, path, body) => {
  const req = request(app)[method](`/api/social${path}`).set('Origin', origin);
  if (actor) req.set('Cookie', cookies[actor]);
  return body === undefined ? req : req.send(body);
};
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('social-tests'); });
beforeEach(async () => {
  await db.dropDatabase();
  const auth = await createAuth({ db, config: { appOrigin: origin } });
  for (const user of accounts) {
    await db.collection('users').insertOne({ ...user, usernameKey: user.username.toLowerCase(), emailKey: `${user._id}@example.test`, email: `${user._id}@example.test`, emailVerified: true, authVersion: 0, role: 'player' });
    const token = randomBytes(32).toString('base64url');
    await db.collection('sessions').insertOne({ _id: createHash('sha256').update(token).digest('hex'), userId: user._id, authVersion: 0, expiresAt: new Date(Date.now() + 60000) });
    cookies[user._id] = `orbit_session=${token}`;
  }
  app = express(); app.use(express.json(), auth.authenticate); app.use('/api/social', await createSocial({ db, config: { appOrigin: origin }, auth }));
  app.use('/api/auth', auth.router);
});
after(async () => { await client?.close(); await mongo?.stop(); });

test('friendships require both verified peers, same age band and recipient acceptance', async () => {
  assert.equal((await api(null, 'get', '/friends')).status, 401);
  assert.equal((await api('alice', 'post', '/requests', { username: 'Alice' })).status, 404);
  assert.equal((await api('alice', 'post', '/requests', { username: 'Adult' })).status, 404);
  await db.collection('users').updateOne({ _id: 'bobby' }, { $set: { emailVerified: false } });
  assert.equal((await api('alice', 'post', '/requests', { username: 'Bobby' })).status, 404);
  assert.equal((await api('bobby', 'post', '/requests', { username: 'Alice' })).status, 403);
  await db.collection('users').updateOne({ _id: 'bobby' }, { $set: { emailVerified: true } });
  const created = await api('alice', 'post', '/requests', { username: 'Bobby' });
  assert.equal(created.status, 201);
  const id = created.body.requestId;
  assert.equal((await api('carol', 'post', `/requests/${id}/accept`, {})).status, 404);
  assert.equal((await api('alice', 'post', `/requests/${id}/accept`, {})).status, 404);
  assert.equal((await api('bobby', 'get', '/friends')).body.incoming.length, 1);
  assert.equal((await api('alice', 'get', '/friends')).body.outgoing.length, 1);
  assert.equal((await api('bobby', 'post', `/requests/${id}/accept`, {})).status, 200);
  const friends = (await api('alice', 'get', '/friends')).body.friends;
  assert.equal(friends[0].user.username, 'Bobby');
  assert.equal(friends[0].user.email, undefined);
  assert.equal((await api('alice', 'post', '/remove', { userId: 'bobby' })).status, 200);
  assert.equal((await api('bobby', 'get', '/friends')).body.friends.length, 0);
});
test('concurrent and reciprocal duplicate requests produce one atomic pair', async () => {
  const results = await Promise.all([
    api('alice', 'post', '/requests', { username: 'Bobby' }),
    api('alice', 'post', '/requests', { username: 'Bobby' }),
    api('bobby', 'post', '/requests', { username: 'Alice' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal(await db.collection('socialPairs').countDocuments(), 1);
});
test('blocking clears relationships and prevents exposure or resurrection by concurrent actions', async () => {
  const created = await api('alice', 'post', '/requests', { username: 'Bobby' });
  const id = created.body.requestId;
  await Promise.all([api('bobby', 'post', `/requests/${id}/accept`, {}), api('alice', 'post', '/block', { userId: 'bobby' })]);
  assert.equal((await api('bobby', 'get', '/friends')).body.friends.length, 0);
  assert.equal((await api('alice', 'get', '/search?username=Bobby')).body.user, null);
  assert.equal((await api('bobby', 'get', '/search?username=Alice')).body.user, null);
  assert.equal((await api('bobby', 'post', '/requests', { username: 'Alice' })).status, 409);
  assert.equal((await api('bobby', 'post', `/requests/${id}/accept`, {})).status, 404);
  assert.deepEqual((await api('alice', 'get', '/blocks')).body.blocks, [{ userId: 'bobby' }]);
  await api('bobby', 'post', '/block', { userId: 'alice' });
  await api('alice', 'post', '/unblock', { userId: 'bobby' });
  assert.equal((await api('alice', 'get', '/search?username=Bobby')).body.user, null);
  await api('bobby', 'post', '/unblock', { userId: 'alice' });
  assert.equal((await api('alice', 'get', '/friends')).body.friends.length, 0);
  assert.equal((await api('alice', 'get', '/search?username=Bobby')).body.user.username, 'Bobby');
});
test('profiles enforce presets and plain bounded text without privilege fields', async () => {
  const update = await api('alice', 'patch', '/profile', { avatar: 'teal', biography: 'I build racing games.' });
  assert.equal(update.status, 200);
  assert.equal(update.body.user.avatar, 'teal');
  assert.equal((await api('alice', 'patch', '/profile', { role: 'admin' })).status, 400);
  assert.equal((await api('alice', 'patch', '/profile', { avatar: 'https://evil.example' })).status, 400);
  assert.equal((await api('alice', 'patch', '/profile', { biography: '<script>alert(1)</script>' })).status, 400);
  assert.equal((await api('alice', 'patch', '/profile', { biography: 'a'.repeat(161) })).status, 400);
  assert.equal((await api('alice', 'get', '/search?username=Bo')).status, 400);
  assert.equal((await api('alice', 'get', '/search?username=Bobb')).body.user, null);
  assert.equal((await request(app).post('/api/social/block').set('Cookie', cookies.alice).set('Origin', 'https://evil.example').send({ userId: 'bobby' })).status, 403);
  await db.collection('users').updateOne({ _id: 'bobby' }, { $set: { suspended: true } });
  assert.equal((await api('alice', 'get', '/search?username=Bobby')).body.user, null);
  assert.equal((await api('bobby', 'get', '/friends')).status, 401);
});

test('presence is opt-in, friend-only, age-aware, expiring, block-safe and cleared by logout', async () => {
  assert.deepEqual((await api('alice', 'get', '/presence')).body, { sharing: false, onlineFriendIds: [] });
  assert.equal((await api('alice', 'post', '/presence/heartbeat', {})).body.sharing, false);
  assert.equal((await db.collection('users').findOne({ _id: 'alice' })).presenceExpiresAt, undefined);
  assert.equal((await api('alice', 'patch', '/presence', { sharing: true, userId: 'bobby' })).status, 400);
  assert.equal((await request(app).patch('/api/social/presence').set('Cookie', cookies.alice).set('Origin', 'https://wrong.example').send({ sharing: true })).status, 403);
  assert.equal((await api('alice', 'patch', '/presence', { sharing: true })).status, 200);
  await api('alice', 'post', '/presence/heartbeat', {});
  assert.deepEqual((await api('bobby', 'get', '/presence')).body.onlineFriendIds, []);
  const created = await api('alice', 'post', '/requests', { username: 'Bobby' });
  await api('bobby', 'post', `/requests/${created.body.requestId}/accept`, {});
  assert.deepEqual((await api('bobby', 'get', '/presence')).body.onlineFriendIds, ['alice']);
  assert.deepEqual((await api('carol', 'get', '/presence')).body.onlineFriendIds, []);
  await db.collection('users').updateOne({ _id: 'alice' }, { $inc: { authVersion: 1 } });
  assert.deepEqual((await api('bobby', 'get', '/presence')).body.onlineFriendIds, []);
  await db.collection('users').updateOne({ _id: 'alice' }, { $set: { authVersion: 0 } }); // Restore the test fixture's session.
  await db.collection('users').updateOne({ _id: 'alice' }, { $set: { adultAt: new Date(Date.now() - 1000) } });
  assert.deepEqual((await api('bobby', 'get', '/presence')).body.onlineFriendIds, []);
  await db.collection('users').updateOne({ _id: 'alice' }, { $unset: { adultAt: '' }, $set: { presenceExpiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual((await api('bobby', 'get', '/presence')).body.onlineFriendIds, []);
  await api('alice', 'post', '/presence/heartbeat', {});
  await api('alice', 'patch', '/presence', { sharing: false });
  assert.deepEqual((await api('bobby', 'get', '/presence')).body.onlineFriendIds, []);
  await api('alice', 'patch', '/presence', { sharing: true }); await api('alice', 'post', '/presence/heartbeat', {});
  await api('bobby', 'post', '/block', { userId: 'alice' });
  assert.deepEqual((await api('bobby', 'get', '/presence')).body.onlineFriendIds, []);
  const logout = await request(app).post('/api/auth/logout').set('Cookie', cookies.alice).set('Origin', origin).send({}); assert.equal(logout.status, 200);
  assert.equal((await db.collection('users').findOne({ _id: 'alice' })).presenceExpiresAt, undefined);
});
