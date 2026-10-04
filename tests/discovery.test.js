import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createDiscovery } from '../src/discovery.js';
let mongo, client, db, app, publicIds;
before(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('discovery-tests');
  const games = Array.from({ length: 75 }, (_, index) => ({ _id: randomUUID(), title: `World ${index}`,
    description: index === 74 ? 'Rare needle exploration' : 'An independent game', genre: 'adventure',
    status: 'published', publishedVersion: randomUUID(), publishedAt: new Date('2026-10-01'), ownerId: 'private-owner', internalNote: 'private' }));
  publicIds = games.map(game => game._id).sort().reverse();
  await db.collection('projects').insertMany([...games,
    { ...games[0], _id: randomUUID(), status: 'draft' },
    { ...games[0], _id: randomUUID(), suspended: true },
    { ...games[0], _id: randomUUID(), status: 'suspended' },
  ]);
  app = express(); app.use('/games', await createDiscovery({ db }));
});
after(async () => { await client?.close(); await mongo?.stop(); });

test('all published games remain reachable beyond 60 with deterministic ties and private fields excluded', async () => {
  const ids = []; let cursor;
  do {
    const response = await request(app).get('/games').query(cursor ? { cursor } : {});
    assert.equal(response.status, 200); assert.ok(response.body.games.length <= 24);
    for (const game of response.body.games) {
      ids.push(game._id); assert.equal(game.ownerId, undefined); assert.equal(game.internalNote, undefined);
    }
    cursor = response.body.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, publicIds); assert.equal(new Set(ids).size, 75);
});

test('search spans the database, escapes regex characters, and rejects malformed or cross-search cursors', async () => {
  const result = await request(app).get('/games').query({ q: 'rare NEEDLE' });
  assert.equal(result.body.games.length, 1); assert.equal(result.body.games[0].title, 'World 74');
  assert.equal((await request(app).get('/games').query({ q: '.*' })).body.games.length, 0);
  assert.equal((await request(app).get('/games').query({ q: 'a'.repeat(81) })).status, 400);
  assert.equal((await request(app).get('/games').query({ cursor: 'broken' })).status, 400);
  assert.equal((await request(app).get('/games').query({ skip: 999 })).status, 400);
  const first = await request(app).get('/games');
  assert.equal((await request(app).get('/games').query({ q: 'World', cursor: first.body.nextCursor })).status, 400);
});

test('later pages recheck publication visibility when a project is suspended', async () => {
  const first = await request(app).get('/games');
  const hidden = publicIds[30];
  await db.collection('projects').updateOne({ _id: hidden }, { $set: { status: 'suspended' } });
  const next = await request(app).get('/games').query({ cursor: first.body.nextCursor });
  assert.equal(next.status, 200); assert.equal(next.body.games.some(game => game._id === hidden), false);
});
