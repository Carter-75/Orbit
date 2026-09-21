import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Binary } from 'mongodb';
import { createProjects } from '../src/projects.js';

let mongo, client, db, app;
const origin = 'http://localhost:3000';
function archive() {
  const entries = [['orbit.json', JSON.stringify({ version: 1, title: 'Independent game', capabilities: ['identity', 'multiplayer'], maxPlayers: 8 })], ['index.html', '<!doctype html><title>A creator game</title>']];
  const local = [], directory = []; let offset = 0;
  for (const [path, text] of entries) {
    const name = Buffer.from(path), content = Buffer.from(text); let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 14); header.writeUInt32LE(content.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); header.copy(central, 6, 4); central.writeUInt32LE(offset, 42);
    local.push(header, name, content); directory.push(central, name); offset += header.length + name.length + content.length;
  }
  const records = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(records.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, records, end]);
}
const post = (path, body = {}, user = 'creator') => request(app).post(`/api/projects${path}`).set('Origin', origin).set('X-Test-User', user).send(body);
const get = (path, user = 'creator') => request(app).get(`/api/projects${path}`).set('X-Test-User', user);
const upload = (id, bytes = archive(), user = 'creator') => request(app).post(`/api/projects/${id}/versions`).set('Origin', origin).set('X-Test-User', user).attach('package', bytes, 'game.zip');
before(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('projects-tests');
  await db.collection('users').insertMany([{ _id: 'creator', emailVerified: true }, { _id: 'outsider', emailVerified: true }, { _id: 'unverified', emailVerified: false }, { _id: 'limited', emailVerified: true, projectCount: 19 }]);
  app = express(); app.use(express.json());
  // Authentication is intentionally a test fixture; actual accounts/session checks are covered separately.
  app.use(async (req, _res, next) => { req.user = await db.collection('users').findOne({ _id: req.get('X-Test-User') || '' }); next(); });
  app.use('/api/projects', await createProjects({ db, config: { appOrigin: origin }, auth: { requireUser: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in.' }) } }));
});
after(async () => { await client?.close(); await mongo?.stop(); });

test('requires authentication, verification, correct origin and owner isolation', async () => {
  assert.equal((await request(app).get('/api/projects')).status, 401);
  assert.equal((await post('/', { title: 'Not yet' }, 'unverified')).status, 403);
  assert.equal((await request(app).post('/api/projects').set('X-Test-User', 'creator').send({ title: 'No origin' })).status, 403);
  const created = await post('/', { title: 'Owned game', description: 'An actual project', genre: 'adventure' }); assert.equal(created.status, 201);
  const id = created.body.project.id;
  assert.equal((await get(`/${id}`, 'outsider')).status, 404);
  assert.equal((await upload(id, archive(), 'outsider')).status, 404);
  assert.equal((await get('/', 'outsider')).body.projects.length, 0);
  assert.equal((await get(`/${id}`)).body.project.title, 'Owned game');
});
test('rejects invalid package without persisting assets or consuming a version slot', async () => {
  const { body } = await post('/', { title: 'Validation' }), id = body.project.id;
  assert.equal((await upload(id, Buffer.from('invalid archive'))).status, 400);
  assert.equal(await db.collection('assets').countDocuments({ projectId: id }), 0);
  assert.equal(await db.collection('versions').countDocuments({ projectId: id }), 0);
  assert.equal((await db.collection('projects').findOne({ _id: id })).versionCount, 0);
});
test('stages complete builds, requires real approval, publishes and rolls back approved versions', async () => {
  const created = await post('/', { title: 'Playable' }), id = created.body.project.id;
  const first = await upload(id); assert.equal(first.status, 201, JSON.stringify(first.body));
  const a = first.body.version.id;
  assert.equal(first.body.version.status, 'ready');
  const asset = await db.collection('assets').findOne({ versionId: a, path: 'index.html' }); assert.ok(asset.content instanceof Binary); assert.match(asset.content.toString(), /creator game/);
  assert.equal((await post(`/${id}/publish`, { versionId: a })).status, 409);
  assert.equal((await post(`/${id}/versions/${a}/submit`)).body.version.status, 'pending');
  assert.equal((await post(`/${id}/publish`, { versionId: a })).status, 409);
  // Simulates an independently authorized moderator decision; router exposes no approval bypass.
  await db.collection('versions').updateOne({ _id: a }, { $set: { status: 'approved', reviewedBy: 'moderator' } });
  assert.equal((await post(`/${id}/publish`, { versionId: a })).body.project.publishedVersion, a);
  const second = await upload(id), b = second.body.version.id;
  await post(`/${id}/versions/${b}/submit`);
  assert.equal((await get(`/${id}`)).body.project.status, 'published');
  await db.collection('versions').updateOne({ _id: b }, { $set: { status: 'approved' } });
  assert.equal((await post(`/${id}/publish`, { versionId: b })).body.project.publishedVersion, b);
  assert.equal((await post(`/${id}/rollback`, { versionId: a })).body.project.publishedVersion, a);
  const other = await post('/', { title: 'Different project' });
  assert.equal((await post(`/${other.body.project.id}/publish`, { versionId: a })).status, 409);
  await db.collection('projects').updateOne({ _id: id }, { $set: { suspended: true } });
  assert.equal((await post(`/${id}/rollback`, { versionId: b })).status, 403);
  assert.equal((await upload(id)).status, 403);
});
test('atomic quotas withstand concurrent project creation and bound version storage', async () => {
  const results = await Promise.all([post('/', { title: 'Last A' }, 'limited'), post('/', { title: 'Last B' }, 'limited')]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const created = await post('/', { title: 'Full project' }), id = created.body.project.id;
  await db.collection('projects').updateOne({ _id: id }, { $set: { versionCount: 20 } });
  assert.equal((await upload(id)).status, 409);
  assert.equal(await db.collection('versions').countDocuments({ projectId: id }), 0);
});

test('storage failure cleans partial assets and never finalizes a build', async () => {
  const created = await post('/', { title: 'Storage failure' }), id = created.body.project.id;
  // A real MongoDB validator rejects the second asset after the first was inserted.
  await db.command({ collMod: 'assets', validator: { path: { $ne: 'index.html' } } });
  try {
    const result = await upload(id); assert.equal(result.status, 500);
    assert.equal(await db.collection('assets').countDocuments({ projectId: id }), 0);
    assert.equal(await db.collection('versions').countDocuments({ projectId: id }), 0);
    assert.equal((await db.collection('projects').findOne({ _id: id })).versionCount, 0);
  } finally { await db.command({ collMod: 'assets', validator: {} }); }
});
