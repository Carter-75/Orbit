import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { gameAccess } from './game-access.js';

const schema = z.object({ recipientId: z.string().uuid(), roomId: z.string().uuid() }).strict();
const band = user => user.ageBand === 'teen' && user.adultAt && user.adultAt <= new Date() ? 'adult' : user.ageBand;
export async function createInvitations({ db, config, auth, getRooms }) {
  const router = Router(), invites = db.collection('gameInvitations');
  await invites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await invites.createIndex({ recipientId: 1, status: 1, expiresAt: 1 });
  router.use(auth.requireUser);
  router.use(async (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== config.appOrigin) return res.status(403).json({ error: 'Request origin is not permitted.' });
    const user = await db.collection('users').findOne({ _id: req.user._id, suspended: { $ne: true }, emailVerified: true });
    if (!user) return res.status(403).json({ error: 'A verified account is required.' });
    req.user = user; res.set('Cache-Control', 'no-store'); next();
  });
  async function eligible(invite) {
    const room = getRooms()?.get(invite.roomId);
    const peer = room?.members.get(invite.senderId);
    if (!room || room.preview || !peer || peer.ws.readyState !== 1 || (room.members.size >= room.capacity && !room.members.has(invite.recipientId))) return null;
    const [sender, recipient, pair] = await Promise.all([
      auth.resolveSession(peer.cookie),
      db.collection('users').findOne({ _id: invite.recipientId, suspended: { $ne: true }, emailVerified: true }),
      db.collection('socialPairs').findOne({ members: { $all: [invite.senderId, invite.recipientId] }, status: 'accepted', blockedBy: { $size: 0 } }),
    ]);
    if (!sender?.emailVerified || sender._id !== invite.senderId || !recipient || !pair || !['teen', 'adult'].includes(band(sender)) || band(sender) !== band(recipient)) return null;
    const access = await gameAccess(db, sender, peer.grantId, 'multiplayer');
    if (!access || access.grant.preview || access.project._id !== room.projectId || access.project.publishedVersion !== room.versionId || access.version._id !== room.versionId) return null;
    // The room can disappear during the asynchronous account/build checks.
    if (getRooms()?.get(invite.roomId) !== room || room.members.get(invite.senderId) !== peer || peer.ws.readyState !== 1) return null;
    return { room, sender, project: access.project };
  }
  router.post('/', rateLimit({ windowMs: 60000, limit: 10, keyGenerator: req => req.user._id,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait before sending more invitations.' } }), async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || parsed.data.recipientId === req.user._id) return res.status(400).json({ error: 'Choose a friend and a live room.' });
    const invite = { _id: randomUUID(), ...parsed.data, senderId: req.user._id, status: 'pending', createdAt: new Date(), expiresAt: new Date(Date.now() + 5 * 60000) };
    if (!await eligible(invite)) return res.status(404).json({ error: 'This friend or room is unavailable for an invitation.' });
    await invites.insertOne(invite); res.status(201).json({ invitation: { id: invite._id, expiresAt: invite.expiresAt } });
  });
  router.get('/', async (req, res) => {
    const rows = await invites.find({ recipientId: req.user._id, status: 'pending', expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(50).toArray();
    const invitations = [];
    for (const invite of rows) {
      const access = await eligible(invite);
      if (access) invitations.push({ id: invite._id, senderName: access.sender.username, projectTitle: access.project.title, expiresAt: invite.expiresAt });
    }
    res.json({ invitations });
  });
  router.post('/:id/accept', async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(404);
    const filter = { _id: req.params.id, recipientId: req.user._id, status: 'pending', expiresAt: { $gt: new Date() } };
    const invite = await invites.findOne(filter); const access = invite && await eligible(invite);
    if (!access) return res.status(404).json({ error: 'Invitation expired or the room is unavailable.' });
    const used = await invites.updateOne(filter, { $set: { status: 'accepted' } });
    if (!used.modifiedCount) return res.status(409).json({ error: 'Invitation was already handled.' });
    // This is only a routing hint, never a launch credential or seat reservation.
    // Launch and WebSocket join independently recheck authorization and capacity.
    res.json({ projectId: access.project._id, projectTitle: access.project.title, roomId: invite.roomId });
  });
  router.post('/:id/decline', async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(404);
    await invites.updateOne({ _id: req.params.id, recipientId: req.user._id, status: 'pending' }, { $set: { status: 'declined' } });
    res.json({ ok: true });
  });
  return router;
}
