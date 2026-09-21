import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import WebSocket from 'ws';
import { attachRealtime } from '../src/realtime.js';

test('authenticated rooms synchronize two users, enforce limits/age/blocks and clean reconnects', async () => {
  const mongo = await MongoMemoryServer.create(); const client = await MongoClient.connect(mongo.getUri());
  const db = client.db('realtime'); const users = new Map(); const sockets = [];
  const server = http.createServer((_req, res) => res.end()); const origin = 'http://localhost:3000';
  const realtime = attachRealtime({ server, db, config: { appOrigin: origin }, auth: { resolveSession: async cookie => users.get(cookie) || null } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  async function player(id, ageBand = 'teen') {
    users.set(id, { _id: id, username: id, ageBand, authVersion: 0, emailVerified: true });
    const grantId = randomBytes(32).toString('hex');
    await db.collection('launchGrants').insertOne({ _id: grantId, userId: id, authVersion: 0, projectId: 'game', versionId: 'v1', expiresAt: new Date(Date.now() + 60000) });
    return grantId;
  }
  async function connect(id) {
    const ws = new WebSocket(url, { headers: { Origin: origin, Cookie: id } }); sockets.push(ws);
    const messages = []; const listeners = new Set();
    ws.on('message', raw => { const message = JSON.parse(raw); messages.push(message); for (const fn of listeners) fn(); });
    ws.on('error', () => {});
    const next = (predicate) => new Promise((resolve, reject) => {
      const check = () => { const i = messages.findIndex(predicate); if (i >= 0) { clearTimeout(timer); listeners.delete(check); resolve(messages.splice(i, 1)[0]); } };
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Expected room event not received')); }, 3000);
      listeners.add(check); check();
    });
    await next(m => m.type === 'connected');
    return { ws, next, send: message => ws.send(JSON.stringify(message)) };
  }
  try {
    await db.collection('projects').insertOne({ _id: 'game', status: 'published', publishedVersion: 'v1', ownerId: 'creator' });
    await db.collection('versions').insertOne({ _id: 'v1', projectId: 'game', status: 'approved', manifest: { capabilities: ['multiplayer'], maxPlayers: 2 } });
    const aGrant = await player('Alice'), bGrant = await player('Bob'), cGrant = await player('Casey'), adultGrant = await player('Adult', 'adult');
    const a = await connect('Alice'), b = await connect('Bob');
    a.send({ type: 'join', grantId: bGrant }); assert.match((await a.next(m => m.type === 'error')).error, /denied/);
    a.send({ type: 'join', grantId: aGrant }); const roomId = (await a.next(m => m.type === 'room')).roomId;
    const adult = await connect('Adult'); adult.send({ type: 'join', grantId: adultGrant, roomId }); assert.match((await adult.next(m => m.type === 'error')).error, /unavailable/);
    b.send({ type: 'join', grantId: bGrant, roomId }); assert.equal((await b.next(m => m.type === 'room')).players.length, 2);
    a.send({ type: 'state', state: { x: 12, y: 34 } });
    assert.deepEqual((await b.next(m => m.type === 'room' && m.players.some(p => p.state?.x === 12))).players.find(p => p.id === 'Alice').state, { x: 12, y: 34 });
    const c = await connect('Casey'); c.send({ type: 'join', grantId: cGrant, roomId }); assert.match((await c.next(m => m.type === 'error')).error, /full/);
    a.send({ type: 'chat', phrase: 0 }); assert.equal((await b.next(m => m.type === 'chat')).text, 'Hello!');
    await db.collection('socialPairs').insertOne({ _id: 'ab', members: ['Alice', 'Bob'], blockedBy: ['Alice'] });
    b.send({ type: 'state', state: {} }); assert.match((await b.next(m => m.type === 'error')).error, /ended/);
    assert.equal(realtime.rooms.get(roomId).members.size, 1);
    b.send({ type: 'join', grantId: bGrant, roomId }); assert.match((await b.next(m => m.type === 'error')).error, /unavailable/);
    const a2 = await connect('Alice'); a2.send({ type: 'join', grantId: aGrant, roomId });
    assert.equal((await a2.next(m => m.type === 'room')).players.length, 1);
    users.delete('Alice'); a2.send({ type: 'state', state: {} });
    await new Promise(resolve => a2.ws.once('close', resolve));
    assert.equal(realtime.rooms.size, 0);
    const bad = new WebSocket(url, { headers: { Origin: 'https://attacker.example', Cookie: 'Bob' } }); sockets.push(bad);
    const status = await new Promise(resolve => { bad.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode); bad.terminate(); }); bad.on('error', () => {}); });
    assert.equal(status, 403);
  } finally { for (const ws of sockets) ws.terminate(); realtime.close(); await new Promise(resolve => server.close(resolve)); await client.close(); await mongo.stop(); }
});
