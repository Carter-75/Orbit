import http from 'node:http';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import WebSocket from 'ws';
import { createAuth } from '../src/auth.js';
import { attachRealtime } from '../src/realtime.js';

// Local-only: deliberately accepts no target URL or database URI. Never sends
// load to a deployed service or uses accounts from the operator environment.
const { values } = parseArgs({ options: { players: { type: 'string', default: '24' },
  seconds: { type: 'string', default: '10' }, hz: { type: 'string', default: '5' } }, strict: true });
const players = Number(values.players), seconds = Number(values.seconds), hz = Number(values.hz);
if (!Number.isInteger(players) || players < 2 || players > 128 || !Number.isInteger(seconds) || seconds < 2 || seconds > 60 ||
  !Number.isInteger(hz) || hz < 1 || hz > 10) throw new Error('Use 2–128 players, 2–60 seconds and 1–10 Hz.');
let mongo, client, server, realtime, shuttingDown = false;
const sockets = [], latencies = [], errors = []; let snapshots = 0, sent = 0, sequence = 0;
const histogram = monitorEventLoopDelay({ resolution: 10 });
const databaseTimings = new Map(); let profiling = false;
const rounded = n => Math.round(n * 100) / 100;
function percentile(values, fraction) { return values.length ? rounded([...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]) : null; }
try {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); const database = client.db('orbit-local-load');
  // Instrument only findOne wall time in this local harness. Never retain query
  // values, account identifiers, credentials or returned documents in metrics.
  const collections = new Map();
  const db = { collection(name) {
    if (!collections.has(name)) {
      const collection = database.collection(name);
      collections.set(name, new Proxy(collection, { get(target, property) {
        if (property === 'findOne') return async (...args) => {
          const measure = profiling, started = performance.now();
          try { return await target.findOne(...args); }
          finally { if (measure) { if (!databaseTimings.has(name)) databaseTimings.set(name, []); databaseTimings.get(name).push(performance.now() - started); } }
        };
        const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
      } }));
    }
    return collections.get(name);
  } };
  const origin = 'http://localhost:3000', auth = await createAuth({ db, config: { appOrigin: origin } });
  await db.collection('socialPairs').createIndex({ members: 1 });
  const projectId = randomUUID(), versionId = randomUUID();
  await db.collection('projects').insertOne({ _id: projectId, ownerId: 'load-fixture', status: 'published', publishedVersion: versionId });
  await db.collection('versions').insertOne({ _id: versionId, projectId, status: 'approved', manifest: { capabilities: ['multiplayer'], maxPlayers: 8 } });
  server = http.createServer((_req, res) => res.end()); realtime = attachRealtime({ server, db, config: { appOrigin: origin }, auth });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const roomIds = [];
  for (let i = 0; i < players; i++) {
    const id = randomUUID(), token = randomBytes(32).toString('base64url'), sessionId = createHash('sha256').update(token).digest('hex'), grantId = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 300000);
    await db.collection('users').insertOne({ _id: id, username: `Load${i}`, usernameKey: `load${i}`, emailKey: `load${i}@example.test`,
      role: 'player', ageBand: 'adult', emailVerified: true, authVersion: 0 });
    await db.collection('sessions').insertOne({ _id: sessionId, userId: id, authVersion: 0, expiresAt });
    await db.collection('launchGrants').insertOne({ _id: grantId, userId: id, authVersion: 0, sessionId, projectId, versionId, preview: false, adminMfaRequired: false, expiresAt });
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { Origin: origin, Cookie: `orbit_session=${token}` } });
    const peer = { ws, id, latest: null, pending: null, connected: false }; sockets.push(peer);
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'connected') peer.connected = true;
      if (message.type === 'error') errors.push(message.error);
      if (message.type === 'room') {
        snapshots++; peer.latest = message;
        if (peer.pending && message.players.some(p => p.id === id && p.state?.sequence === peer.pending.sequence)) {
          const pending = peer.pending; peer.pending = null; clearTimeout(pending.timer);
          latencies.push(performance.now() - pending.started); pending.resolve();
        }
      }
    });
    ws.on('error', () => errors.push('socket_error'));
    ws.on('close', () => { if (!shuttingDown) errors.push('unexpected_close'); });
    const waitFor = async predicate => { const start = performance.now(); while (!predicate()) { if (performance.now() - start > 5000) throw new Error('Connection or join timed out'); await delay(5); } };
    await waitFor(() => peer.connected);
    ws.send(JSON.stringify({ type: 'join', grantId, ...(i % 8 ? { roomId: roomIds.at(-1) } : {}) }));
    await waitFor(() => peer.latest !== null);
    if (i % 8 === 0) roomIds.push(peer.latest.roomId);
  }
  const roomCount = realtime.rooms.size, snapshotStart = snapshots;
  histogram.enable(); profiling = true; const cpuStart = process.cpuUsage(); const start = performance.now(); const rssStart = process.memoryUsage().rss;
  while (performance.now() - start < seconds * 1000) {
    const roundStart = performance.now(); sequence++;
    await Promise.all(sockets.map(peer => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { peer.pending = null; reject(new Error('State acknowledgement timed out')); }, 5000);
      peer.pending = { sequence, started: performance.now(), resolve, timer }; sent++;
      peer.ws.send(JSON.stringify({ type: 'state', state: { sequence, x: sequence % 100, y: 50 } }));
    })));
    await delay(Math.max(0, 1000 / hz - (performance.now() - roundStart)));
  }
  const elapsed = performance.now() - start; histogram.disable(); profiling = false; const cpu = process.cpuUsage(cpuStart);
  // Each member must also see the final state from every other room member.
  const syncStart = performance.now();
  while (!sockets.every(peer => peer.latest.players.every(p => p.state?.sequence === sequence))) {
    if (performance.now() - syncStart > 5000) throw new Error('Peer broadcast synchronization timed out'); await delay(5);
  }
  const report = { scope: 'local-loopback-disposable-MongoDB', node: process.version, platform: process.platform,
    players, rooms: roomCount, targetHzPerPlayer: hz, durationSeconds: rounded(elapsed / 1000),
    stateMessages: sent, acknowledgements: latencies.length, observedHzPerPlayer: rounded(sent / players / (elapsed / 1000)),
    targetRateWithinFivePercent: sent / players / (elapsed / 1000) >= hz * .95,
    receivedSnapshots: snapshots - snapshotStart, finalPeerStatesSynchronized: true, errors: errors.length,
    roundTripMs: { p50: percentile(latencies, .5), p95: percentile(latencies, .95), p99: percentile(latencies, .99), max: rounded(Math.max(...latencies)) },
    eventLoopDelayMs: { p95: rounded(histogram.percentile(95) / 1e6), max: rounded(histogram.max / 1e6) },
    findOneWallTimeByCollection: Object.fromEntries([...databaseTimings].map(([name, times]) => [name, {
      calls: times.length, callsPerStateMessage: rounded(times.length / sent), p50Ms: percentile(times, .5), p95Ms: percentile(times, .95),
    }])),
    combinedServerAndGeneratorCpuMs: { user: rounded(cpu.user / 1000), system: rounded(cpu.system / 1000) },
    combinedServerAndGeneratorRssMiB: { start: rounded(rssStart / 1048576), end: rounded(process.memoryUsage().rss / 1048576) },
    limitations: 'Client and server share one Node process. Excludes Mongo process memory, real network/TLS, HTTP/assets, sign-in cost and Render/Atlas sizing. Closed-loop load backs off under delay; not maximum capacity.' };
  shuttingDown = true; for (const peer of sockets) peer.ws.terminate();
  const closeStart = performance.now();
  while (realtime.rooms.size && performance.now() - closeStart < 5000) await delay(10);
  report.roomsAfterDisconnect = realtime.rooms.size;
  console.log(JSON.stringify(report, null, 2));
  if (errors.length || latencies.length !== sent || report.roomsAfterDisconnect) process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ result: 'failed', message: error.message, sent, acknowledged: latencies.length })); process.exitCode = 1; }
finally {
  shuttingDown = true; histogram.disable();
  for (const peer of sockets) { clearTimeout(peer.pending?.timer); peer.ws.terminate(); }
  realtime?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  await client?.close(); await mongo?.stop();
}
