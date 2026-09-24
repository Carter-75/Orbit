import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/mail.js';

test('production config rejects missing database, insecure and shared origins', () => {
  assert.throws(() => readConfig({}), /MONGODB_URI/);
  assert.throws(() => readConfig({ MONGODB_URI: 'mongodb://localhost', APP_ORIGIN: 'http://localhost:3001' }), /separate origin/);
  assert.throws(() => readConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://localhost' }), /HTTPS/);
  assert.equal(createMailer({}), null);
});

test('full app hides source, uses real database health and rejects cross-origin mutation', async () => {
  const mongo = await MongoMemoryServer.create();
  let client;
  try {
    const config = readConfig({ MONGODB_URI: mongo.getUri() });
    const connection = await connectDatabase(config); client = connection.client;
    const { app } = await createApp({ db: connection.db, config, sendMail: null });
    assert.equal((await request(app).get('/health/ready')).status, 200);
    const home = await request(app).get('/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(home.text.includes('12,480'), false);
    for (const path of ['/src/auth.js', '/package.json', '/.env', '/archive/prototype-2026-09-20/server.mjs']) {
      assert.equal((await request(app).get(path)).status, 404, path);
    }
    assert.deepEqual((await request(app).get('/api/games')).body, { games: [] });
    assert.equal((await request(app).post('/api/auth/logout').send({})).status, 403);
    const registration = await request(app).post('/api/auth/register').set('Origin', config.appOrigin).send({
      username: 'FreshCreator', email: 'fresh@example.test', password: 'my strong fresh passphrase', dateOfBirth: '2000-01-01',
    });
    assert.equal(registration.status, 201);
    assert.equal(registration.body.emailDeliveryAvailable, false);
    const cookie = registration.headers['set-cookie'].at(-1).split(';')[0];
    // Recreating the application must preserve accounts and sessions in MongoDB.
    const second = await createApp({ db: connection.db, config, sendMail: null });
    assert.equal((await request(second.app).get('/api/auth/me').set('Cookie', cookie)).body.user.username, 'FreshCreator');
    assert.equal((await request(app).post('/api/auth/forgot-password').set('Origin', config.appOrigin).send({email:'fresh@example.test'})).status, 503);
    const closed = await createApp({ db: connection.db, config: { ...config, production: true, publicLaunch: false }, sendMail: null });
    assert.equal((await request(closed.app).post('/api/auth/register').set('Origin', config.appOrigin).send({})).status, 503);
    // Guests sharing one network are bounded, but do not exhaust a signed-in
    // account's quota. Forged cookies are not a separate rate-limit identity.
    for (let i = 0; i < 119; i++) assert.equal((await request(app).get('/api/platform')).status, 200);
    const limited = await request(app).get('/api/platform');
    assert.equal(limited.status, 429);
    assert.match(limited.body.error, /wait a minute/);
    assert.equal(limited.headers['cache-control'], 'no-store');
    assert.ok(limited.headers['retry-after']);
    assert.equal((await request(app).get('/api/platform').set('Cookie', 'orbit_session=forged')).status, 429);
    assert.equal((await request(app).get('/api/platform').set('Cookie', cookie)).status, 200);
  } finally { await client?.close(); await mongo.stop(); }
});
