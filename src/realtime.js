import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { gameAccess } from './game-access.js';

// Single-instance room transport. Durable accounts/builds live in MongoDB; room
// simulation is ephemeral. Scale only after shared room routing is implemented.
export function attachRealtime({ server, db, config, auth }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const rooms = new Map();
  const connections = new Map();
  let pendingUpgrades = 0;
  let joinQueue = Promise.resolve();
  const send = (ws, value) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 65536) { ws.close(1013, 'Slow connection'); return; }
    ws.send(JSON.stringify(value));
  };
  const snapshot = room => ({ type: 'room', roomId: room.id, players: [...room.members.values()].map(p => ({
    id: p.user._id, username: p.user.username, avatar: p.user.avatar || 'violet', state: p.state,
  })) });
  const broadcast = room => { const state = snapshot(room); for (const peer of room.members.values()) send(peer.ws, state); };
  function leave(peer) {
    const room = rooms.get(peer.roomId);
    if (room?.members.get(peer.user._id) === peer) {
      room.members.delete(peer.user._id);
      if (!room.members.size) rooms.delete(room.id); else broadcast(room);
    }
    peer.roomId = null;
  }
  async function compatible(user, members) {
    const ids = [...members.keys()].filter(id => id !== user._id);
    if ([...members.values()].some(peer => peer.user.ageBand !== user.ageBand)) return false;
    if (!ids.length) return true;
    return !(await db.collection('socialPairs').findOne({ members: { $all: [user._id], $in: ids }, 'blockedBy.0': { $exists: true } }));
  }
  async function handle(peer, message) {
    if (!message || typeof message !== 'object') return;
    const user = await auth.resolveSession(peer.cookie);
    if (!user?.emailVerified) { leave(peer); peer.ws.close(1008, 'Account unavailable'); return; }
    peer.user = user;
    if (message.type === 'join') {
      const access = await gameAccess(db, user, message.grantId, 'multiplayer');
      if (!access) return send(peer.ws, { type: 'error', error: 'Game access denied.' });
      if (message.roomId !== undefined && (typeof message.roomId !== 'string' || message.roomId.length > 64)) return;
      let room = message.roomId ? rooms.get(message.roomId) : null;
      if (message.roomId && !room) return send(peer.ws, { type: 'error', error: 'Room has ended. Create a new room.' });
      if (room && (room.projectId !== access.project._id || room.versionId !== access.version._id || room.preview !== access.grant.preview)) return send(peer.ws, { type: 'error', error: 'Room unavailable for this build.' });
      if (room && (!await compatible(user, room.members) || (room.members.size >= room.capacity && !room.members.has(user._id)))) return send(peer.ws, { type: 'error', error: 'Room is full or unavailable.' });
      if (!room && rooms.size >= 100) return send(peer.ws, { type: 'error', error: 'Rooms are busy. Try later.' });
      // A close event can run while the database checks above are pending.
      // Never add a departed socket back after close already cleaned it up.
      if (peer.ws.readyState !== WebSocket.OPEN) return;
      leave(peer);
      if (!room) {
        room = { id: randomUUID(), projectId: access.project._id, versionId: access.version._id,
          preview: access.grant.preview, capacity: Math.min(8, access.version.manifest.maxPlayers || 8), members: new Map() };
        rooms.set(room.id, room);
      } else {
        // Rejoin can remove the last member above; restore this same room atomically.
        rooms.set(room.id, room);
      }
      const previous = room.members.get(user._id);
      if (previous && previous !== peer) { previous.roomId = null; previous.ws.close(1000, 'Joined from another tab'); }
      peer.grantId = message.grantId; peer.roomId = room.id; peer.state = null;
      room.members.set(user._id, peer); broadcast(room); return;
    }
    if (message.type === 'leave') { leave(peer); return; }
    const room = rooms.get(peer.roomId);
    if (!room || !await gameAccess(db, user, peer.grantId, 'multiplayer') || !await compatible(user, room.members)) {
      leave(peer); return send(peer.ws, { type: 'error', error: 'Room access ended.' });
    }
    if (message.type === 'state') {
      if (message.state === undefined || Buffer.byteLength(JSON.stringify(message.state)) > 2048) return send(peer.ws, { type: 'error', error: 'Game state is missing or too large.' });
      peer.state = message.state; broadcast(room);
    }
    if (message.type === 'chat') {
      // Curated phrases are the initial teen-safe transport; free text needs a
      // separate moderation service. Game state is untrusted, not moderated chat.
      const phrases = ['Hello!', 'Great game!', 'Follow me!', 'Ready?', 'Thanks!', 'Goodbye!'];
      if (!Number.isInteger(message.phrase) || !phrases[message.phrase] || Date.now() - peer.lastChat < 1500) return;
      peer.lastChat = Date.now();
      for (const other of room.members.values()) send(other.ws, { type: 'chat', userId: user._id, username: user.username, text: phrases[message.phrase] });
    }
  }
  server.on('upgrade', async (req, socket, head) => {
    if (req.url !== '/ws' || req.headers.origin !== config.appOrigin || pendingUpgrades >= 16 || wss.clients.size >= 200) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    pendingUpgrades++;
    socket.on('error', () => {});
    try {
      const user = await auth.resolveSession(req.headers.cookie);
      if (!user?.emailVerified || (connections.get(user._id) || 0) >= 2) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, ws => {
        connections.set(user._id, (connections.get(user._id) || 0) + 1);
        const peer = { ws, user, cookie: req.headers.cookie, roomId: null, state: null, alive: true, lastChat: 0, window: Date.now(), count: 0 };
        let chain = Promise.resolve(), queued = 0;
        ws.on('error', () => {}); ws.on('pong', () => { peer.alive = true; });
        ws.on('message', (raw, binary) => {
          if (binary) { ws.close(1003, 'JSON required'); return; }
          if (Date.now() - peer.window > 1000) { peer.window = Date.now(); peer.count = 0; }
          if (++peer.count > 30 || ++queued > 8) { ws.close(1008, 'Message limit'); return; }
          chain = chain.then(async () => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const message = JSON.parse(raw);
            // Serialize joins so asynchronous relationship checks cannot race
            // another membership change into an incompatible/full room.
            if (message?.type === 'join') {
              const task = joinQueue.then(() => ws.readyState === WebSocket.OPEN ? handle(peer, message) : undefined);
              joinQueue = task.catch(() => {}); await task;
            } else await handle(peer, message);
          })
            .catch(() => send(ws, { type: 'error', error: 'Invalid or unavailable game request.' })).finally(() => { queued--; });
        });
        ws.on('close', () => {
          leave(peer); const count = (connections.get(user._id) || 1) - 1;
          if (count > 0) connections.set(user._id, count); else connections.delete(user._id);
        });
        ws.peer = peer; send(ws, { type: 'connected' });
      });
    } catch { socket.destroy(); } finally { pendingUpgrades--; }
  });
  const timer = setInterval(async () => {
    for (const ws of wss.clients) {
      const peer = ws.peer;
      if (!peer.alive) { leave(peer); ws.terminate(); continue; }
      peer.alive = false; ws.ping();
      try {
        const user = await auth.resolveSession(peer.cookie);
        const room = rooms.get(peer.roomId);
        if (!user?.emailVerified || (room && (!await gameAccess(db, user, peer.grantId, 'multiplayer') || !await compatible(user, room.members)))) { leave(peer); ws.close(1008, 'Session ended'); }
      } catch { leave(peer); ws.close(1013, 'Service unavailable'); }
    }
  }, 15000); timer.unref();
  return { rooms, close: () => { clearInterval(timer); for (const ws of wss.clients) ws.close(1001, 'Server restarting'); wss.close(); } };
}
