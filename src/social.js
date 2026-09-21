import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash } from 'node:crypto';

const AVATARS = new Set(['violet', 'blue', 'teal', 'amber', 'rose', 'slate']);
const pairId = (a, b) => createHash('sha256').update(JSON.stringify([a, b].sort())).digest('hex');
const safeUser = (user) => ({ id: user._id, username: user.username, avatar: AVATARS.has(user.avatar) ? user.avatar : 'violet', biography: user.biography || '' });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function createSocial({ db, config, auth }) {
  const users = db.collection('users');
  const pairs = db.collection('socialPairs');
  await pairs.createIndex({ members: 1, status: 1 });
  const router = Router();
  const origin = new URL(config.appOrigin).origin;
  router.use(auth.requireUser);
  router.use(wrap(async (req, res, next) => {
    // Never trust stale account state for social mutations.
    const current = await users.findOne({ _id: req.user._id, suspended: { $ne: true } });
    if (!current) return res.status(401).json({ error: 'Sign in to continue.' });
    req.user = current;
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin is not permitted.' });
    next();
  }));
  router.use(rateLimit({ windowMs: 60000, limit: 30, keyGenerator: (req) => req.user._id, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many social requests. Try again shortly.' } }));
  const verified = (req, res, next) => req.user.emailVerified ? next() : res.status(403).json({ error: 'Verify your email first.' });
  const eligible = (a, b) => a.emailVerified && b.emailVerified && ['teen', 'adult'].includes(a.ageBand) && a.ageBand === b.ageBand;
  // Initial product policy: new friendships are restricted to the same age band.
  // This deliberately disallows teen/adult requests; changes require a safety review.
  const available = async (self, other) => {
    if (typeof other !== 'string' || other.length > 80 || self === other) return null;
    return users.findOne({ _id: other, suspended: { $ne: true } });
  };
  async function ensurePair(a, b) {
    const id = pairId(a, b);
    try { await pairs.updateOne({ _id: id }, { $setOnInsert: { members: [a, b].sort(), status: 'none', blockedBy: [] } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    return id;
  }
  router.get('/profile', (req, res) => res.json({ user: safeUser(req.user) }));
  router.patch('/profile', verified, wrap(async (req, res) => {
    const body = req.body || {};
    if (!Object.keys(body).length || Object.keys(body).some((key) => !['avatar', 'biography'].includes(key)) || ('avatar' in body && !AVATARS.has(body.avatar)) || ('biography' in body && (typeof body.biography !== 'string' || body.biography.length > 160 || /[<>\u0000-\u001f]/.test(body.biography)))) return res.status(400).json({ error: 'Choose a supported avatar and a plain-text biography up to 160 characters.' });
    const update = { ...('avatar' in body ? { avatar: body.avatar } : {}), ...('biography' in body ? { biography: body.biography.trim() } : {}) };
    await users.updateOne({ _id: req.user._id }, { $set: update });
    res.json({ user: safeUser({ ...req.user, ...update }) });
  }));
  router.get('/search', wrap(async (req, res) => {
    const username = req.query.username;
    if (typeof username !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(username)) return res.status(400).json({ error: 'Enter an exact username.' });
    const user = await users.findOne({ usernameKey: username.toLowerCase(), suspended: { $ne: true } });
    if (!user || user._id === req.user._id) return res.json({ user: null });
    const pair = await pairs.findOne({ _id: pairId(req.user._id, user._id) });
    res.json({ user: pair?.blockedBy?.length ? null : safeUser(user) });
  }));
  router.get('/friends', wrap(async (req, res) => {
    const rows = await pairs.find({ members: req.user._id, blockedBy: { $size: 0 }, status: { $in: ['pending', 'accepted'] } }).limit(200).toArray();
    const otherIds = rows.map((pair) => pair.members.find((id) => id !== req.user._id));
    const others = await users.find({ _id: { $in: otherIds }, suspended: { $ne: true } }).toArray();
    const byId = new Map(others.map((user) => [user._id, user]));
    const result = { friends: [], incoming: [], outgoing: [] };
    for (const pair of rows) {
      const other = byId.get(pair.members.find((id) => id !== req.user._id));
      if (!other) continue;
      const key = pair.status === 'accepted' ? 'friends' : pair.requestedBy === req.user._id ? 'outgoing' : 'incoming';
      result[key].push({ id: pair._id, user: safeUser(other) });
    }
    res.json(result);
  }));
  router.post('/requests', verified, wrap(async (req, res) => {
    const username = req.body?.username;
    const other = typeof username === 'string' && /^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(username) ? await users.findOne({ usernameKey: username.toLowerCase(), suspended: { $ne: true } }) : null;
    if (!other || other._id === req.user._id || !eligible(req.user, other)) return res.status(404).json({ error: 'This person is not available for a friend request.' });
    const id = await ensurePair(req.user._id, other._id);
    const result = await pairs.updateOne({ _id: id, status: 'none', blockedBy: { $size: 0 } }, { $set: { status: 'pending', requestedBy: req.user._id, requestedAt: new Date() } });
    if (!result.modifiedCount) return res.status(409).json({ error: 'A request cannot be created for this person.' });
    res.status(201).json({ requestId: id, status: 'pending' });
  }));
  router.post('/requests/:id/accept', verified, wrap(async (req, res) => {
    const pair = await pairs.findOne({ _id: req.params.id, members: req.user._id, status: 'pending', requestedBy: { $ne: req.user._id }, blockedBy: { $size: 0 } });
    const other = pair && await available(req.user._id, pair.requestedBy);
    if (!other || !eligible(req.user, other)) return res.status(404).json({ error: 'This request is unavailable.' });
    const result = await pairs.updateOne({ _id: pair._id, status: 'pending', requestedBy: other._id, blockedBy: { $size: 0 } }, { $set: { status: 'accepted', acceptedAt: new Date() } });
    if (!result.modifiedCount) return res.status(409).json({ error: 'This request is no longer available.' });
    res.json({ ok: true });
  }));
  router.post('/requests/:id/reject', wrap(async (req, res) => {
    const result = await pairs.updateOne({ _id: req.params.id, members: req.user._id, status: 'pending', blockedBy: { $size: 0 } }, { $set: { status: 'none' }, $unset: { requestedBy: '', requestedAt: '' } });
    if (!result.modifiedCount) return res.status(404).json({ error: 'This request is unavailable.' });
    res.json({ ok: true });
  }));
  router.post('/block', wrap(async (req, res) => {
    const other = await available(req.user._id, req.body?.userId);
    if (!other) return res.status(404).json({ error: 'This person is unavailable.' });
    const id = await ensurePair(req.user._id, other._id);
    await pairs.updateOne({ _id: id }, { $addToSet: { blockedBy: req.user._id }, $set: { status: 'none' }, $unset: { requestedBy: '', requestedAt: '', acceptedAt: '' } });
    res.json({ ok: true });
  }));
  router.post('/unblock', wrap(async (req, res) => {
    const id = req.body?.userId;
    if (typeof id !== 'string' || id.length > 80 || id === req.user._id) return res.status(400).json({ error: 'Choose a blocked person.' });
    await pairs.updateOne({ _id: pairId(req.user._id, id) }, { $pull: { blockedBy: req.user._id } });
    res.json({ ok: true });
  }));
  router.post('/remove', wrap(async (req, res) => {
    const other = await available(req.user._id, req.body?.userId);
    if (!other) return res.status(404).json({ error: 'This friendship is unavailable.' });
    const result = await pairs.updateOne({ _id: pairId(req.user._id, other._id), status: 'accepted', blockedBy: { $size: 0 } }, { $set: { status: 'none' }, $unset: { requestedBy: '', requestedAt: '', acceptedAt: '' } });
    if (!result.modifiedCount) return res.status(404).json({ error: 'This friendship is unavailable.' });
    res.json({ ok: true });
  }));
  router.get('/blocks', wrap(async (req, res) => {
    const rows = await pairs.find({ members: req.user._id, blockedBy: req.user._id }).limit(200).toArray();
    // IDs alone allow unblocking without exposing profiles hidden by either party.
    res.json({ blocks: rows.map((pair) => ({ userId: pair.members.find((id) => id !== req.user._id) })) });
  }));
  router.use((_error, _req, res, _next) => res.status(500).json({ error: 'Unable to complete this social request.' }));
  return router;
}
