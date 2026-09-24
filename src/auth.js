import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COST = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const passwordOK = (value) => typeof value === 'string' && value.length >= 15 && value.length <= 128;
const emailOK = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// No tokens are persisted in the outbox: workers generate them only when delivering.
export async function drainMailOutbox({ db, sendMail, limit = 10 }) {
  const result = { sent: 0, skipped: 0, retried: 0, failed: 0 };
  if (typeof sendMail !== 'function') return result;
  const outbox = db.collection('mailOutbox');
  const links = db.collection('accountLinks');
  for (let i = 0; i < Math.min(100, Math.max(0, Number(limit) || 0)); i++) {
    const now = new Date();
    const leaseId = randomUUID();
    const job = await outbox.findOneAndUpdate({
      status: { $in: ['queued', 'sending'] }, expiresAt: { $gt: now },
      nextAttemptAt: { $lte: now }, leaseUntil: { $lte: now }, attempts: { $lt: 5 },
    }, { $set: { status: 'sending', leaseId, leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, returnDocument: 'after' });
    if (!job) break;
    const owned = { _id: job._id, leaseId };
    try {
      const user = await db.collection('users').findOne({ emailKey: job.emailKey, suspended: { $ne: true } });
      if (!user || (job.purpose === 'verify' && user.emailVerified)) {
        await outbox.updateOne(owned, { $set: { status: 'skipped' }, $unset: { emailKey: '', origin: '', leaseId: '' } });
        result.skipped++; continue;
      }
      const secret = token();
      const linkId = digest(secret);
      await links.insertOne({ _id: linkId, userId: user._id, purpose: job.purpose, authVersion: user.authVersion, expiresAt: new Date(Date.now() + (job.purpose === 'reset' ? 30 : 1440) * 60000) });
      const url = `${job.origin}/#${job.purpose === 'reset' ? 'reset-password' : 'verify-email'}=${secret}`;
      // A slow database operation must not let a stale worker send after its lease was stolen.
      const renewed = await outbox.updateOne({ ...owned, leaseUntil: { $gt: new Date() } }, { $set: { leaseUntil: new Date(Date.now() + 120000) } });
      if (!renewed.matchedCount) { await links.deleteOne({ _id: linkId }); result.skipped++; continue; }
      const controller = new AbortController();
      let timeout;
      try {
        await Promise.race([
          sendMail({ to: user.email, subject: job.purpose === 'reset' ? 'Reset your Orbit password' : 'Verify your Orbit email', text: `Open this link to ${job.purpose === 'reset' ? 'reset your password' : 'verify your email'}: ${url}\nIf you did not request this, ignore this message.`, signal: controller.signal }),
          new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Delivery timeout')); }, 30000); }),
        ]);
      } finally { clearTimeout(timeout); }
      await outbox.updateOne(owned, { $set: { status: 'sent', sentAt: new Date() }, $unset: { emailKey: '', origin: '', leaseId: '' } });
      result.sent++;
    } catch {
      const delay = Math.min(15 * 60000, 30000 * 2 ** (job.attempts - 1));
      const terminal = job.attempts >= 5 || Date.now() + delay >= job.expiresAt.getTime();
      await outbox.updateOne(owned, { $set: { status: terminal ? 'failed' : 'queued', nextAttemptAt: new Date(Date.now() + delay), leaseUntil: new Date(0) }, $unset: terminal ? { emailKey: '', origin: '', leaseId: '' } : { leaseId: '' } });
      result[terminal ? 'failed' : 'retried']++;
    }
  }
  return result;
}

// Bound memory consumption independently of HTTP request rate limits.
let hashing = 0;
async function derive(password, salt) {
  if (hashing >= 2) { const error = new Error('Authentication busy'); error.status = 503; throw error; }
  hashing++;
  try { return await scrypt(password, salt, 64, COST); } finally { hashing--; }
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$131072$8$1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const valid = parts.length === 6 && parts[0] === 'scrypt' && parts[1] === '131072' && parts[2] === '8' && parts[3] === '1' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  // Unknown accounts perform the same expensive operation as valid accounts.
  const actual = await derive(password, valid ? parts[4] : '00000000000000000000000000000000');
  const expected = Buffer.from(valid ? parts[5] : '00'.repeat(64), 'hex');
  return timingSafeEqual(actual, expected) && valid;
}

export function ageDetails(dateOfBirth, now = new Date()) {
  if (typeof dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (!Number.isFinite(dob.valueOf()) || dob.toISOString().slice(0, 10) !== dateOfBirth || dob > now || dob.getUTCFullYear() < now.getUTCFullYear() - 120) return null;
  const birthday = (years) => { const date = new Date(dob); date.setUTCFullYear(date.getUTCFullYear() + years); return date; };
  if (birthday(13) > now) return null;
  return birthday(18) <= now ? { ageBand: 'adult' } : { ageBand: 'teen', adultAt: birthday(18) };
}

export async function createAuth({ db, config = {}, sendMail }) {
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const links = db.collection('accountLinks');
  const outbox = db.collection('mailOutbox');
  await Promise.all([
    users.createIndex({ emailKey: 1 }, { unique: true }),
    users.createIndex({ usernameKey: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ userId: 1 }),
    links.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    outbox.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    outbox.createIndex({ status: 1, nextAttemptAt: 1, leaseUntil: 1 }),
  ]);
  const router = Router();
  const cookieName = config.production ? '__Host-orbit_session' : 'orbit_session';
  const origin = new URL(config.appOrigin || 'http://localhost:3000').origin;
  const sessionMs = Math.min(30, Math.max(1, Number(config.sessionDays) || 7)) * 86400000;
  const cookieOptions = { httpOnly: true, secure: Boolean(config.production), sameSite: 'strict', path: '/' };
  function publicUser(user) {
    if (!user) return null;
    return { id: user._id, username: user.username, emailVerified: Boolean(user.emailVerified), ageBand: user.ageBand, role: user.role || 'player', avatar: user.avatar || null };
  }
  function cookieValue(header) {
    if (typeof header !== 'string') return null;
    const part = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${cookieName}=`));
    return part?.slice(cookieName.length + 1) || null;
  }
  async function resolveSession(header) {
    const value = cookieValue(header);
    if (!value || !/^[\w-]{43}$/.test(value)) return null;
    const session = await sessions.findOne({ _id: digest(value), expiresAt: { $gt: new Date() } });
    if (!session) return null;
    const user = await users.findOne({ _id: session.userId, authVersion: session.authVersion, suspended: { $ne: true } });
    if (user?.ageBand === 'teen' && user.adultAt && user.adultAt <= new Date()) {
      await users.updateOne({ _id: user._id }, { $set: { ageBand: 'adult' }, $unset: { adultAt: '' } });
      user.ageBand = 'adult'; delete user.adultAt;
    }
    return user;
  }
  const authenticate = asyncRoute(async (req, _res, next) => { req.user = await resolveSession(req.headers.cookie); next(); });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in to continue.' });
  async function clearSession(req, res) {
    const value = cookieValue(req.headers.cookie);
    if (value) {
      const removed = await sessions.findOneAndDelete({ _id: digest(value) });
      if (removed) await users.updateOne({ _id: removed.userId }, { $unset: { presenceExpiresAt: '' } });
    }
    res.clearCookie(cookieName, cookieOptions);
  }
  async function startSession(req, res, user) {
    await clearSession(req, res);
    const value = token();
    await sessions.insertOne({ _id: digest(value), userId: user._id, authVersion: user.authVersion, createdAt: new Date(), expiresAt: new Date(Date.now() + sessionMs) });
    res.cookie(cookieName, value, { ...cookieOptions, maxAge: sessionMs });
  }
  async function emailLink(emailKey, purpose) {
    if (!sendMail) return;
    // Same database work for known/unknown accounts; no delivery awaits in requests.
    const id = digest(`${purpose}:${emailKey}:${Math.floor(Date.now() / 900000)}`);
    try {
      await outbox.updateOne({ _id: id }, { $setOnInsert: { emailKey, purpose, origin, status: 'queued', attempts: 0, createdAt: new Date(), nextAttemptAt: new Date(), leaseUntil: new Date(0), expiresAt: new Date(Date.now() + 30 * 60000) } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Cookie-authenticated mutations must originate at the configured platform.
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin is not permitted.' });
    next();
  });
  const limit = (max) => rateLimit({ windowMs: 15 * 60000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });
  const credentialsLimit = limit(20);
  const recoveryLimit = limit(5);
  router.post('/register', credentialsLimit, asyncRoute(async (req, res) => {
    const { username, email, password, dateOfBirth } = req.body || {};
    const age = ageDetails(dateOfBirth);
    if (typeof username !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(username) || !emailOK(email) || !passwordOK(password) || !age) return res.status(400).json({ error: 'Use a valid email, a 3–24 character username, a 15–128 character password, and a valid date of birth. Orbit is for ages 13 and older.' });
    const user = { _id: randomUUID(), username, usernameKey: username.toLowerCase(), email: email.trim().toLowerCase(), emailKey: email.trim().toLowerCase(), passwordHash: await hashPassword(password), authVersion: 0, emailVerified: false, role: 'player', ...age, createdAt: new Date() };
    try { await users.insertOne(user); } catch (error) { if (error.code === 11000) return res.status(409).json({ error: 'Unable to create this account. Try signing in or choose another username.' }); throw error; }
    await startSession(req, res, user);
    await emailLink(user.emailKey, 'verify');
    res.status(201).json({ user: publicUser(user), emailDeliveryAvailable: Boolean(sendMail) });
  }));
  router.post('/login', credentialsLimit, asyncRoute(async (req, res) => {
    const { identifier, password } = req.body || {};
    if (typeof identifier !== 'string' || identifier.length > 254 || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Enter your username or email and password.' });
    const key = identifier.trim().toLowerCase();
    const user = await users.findOne({ $or: [{ emailKey: key }, { usernameKey: key }] });
    const correct = await verifyPassword(password, user?.passwordHash);
    if (!correct || user?.suspended) return res.status(401).json({ error: 'Invalid sign-in details.' });
    await startSession(req, res, user);
    res.json({ user: publicUser(user) });
  }));
  router.post('/logout', asyncRoute(async (req, res) => { await clearSession(req, res); res.json({ ok: true }); }));
  router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user), emailDeliveryAvailable: Boolean(sendMail) }));
  router.post('/forgot-password', recoveryLimit, asyncRoute(async (req, res) => {
    if (!sendMail) return res.status(503).json({ error: 'Email recovery is temporarily unavailable.' });
    const email = req.body?.email;
    await emailLink(emailOK(email) ? email.trim().toLowerCase() : 'invalid-address', 'reset');
    res.json({ message: 'If an eligible account exists, a password reset link will be sent.' });
  }));
  router.post('/reset-password', credentialsLimit, asyncRoute(async (req, res) => {
    const { token: secret, password } = req.body || {};
    if (typeof secret !== 'string' || !/^[\w-]{43}$/.test(secret) || !passwordOK(password)) return res.status(400).json({ error: 'Use a valid reset link and a 15–128 character password.' });
    const link = await links.findOne({ _id: digest(secret), purpose: 'reset', expiresAt: { $gt: new Date() } });
    if (!link) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    const passwordHash = await hashPassword(password);
    // The version condition atomically prevents concurrent token reuse and makes all prior sessions invalid.
    const result = await users.updateOne({ _id: link.userId, authVersion: link.authVersion }, { $set: { passwordHash }, $inc: { authVersion: 1 } });
    if (!result.modifiedCount) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    await Promise.all([sessions.deleteMany({ userId: link.userId }), links.deleteMany({ userId: link.userId })]);
    await clearSession(req, res);
    res.json({ ok: true, message: 'Password changed. Sign in again.' });
  }));
  router.post('/resend-verification', recoveryLimit, authenticate, requireUser, asyncRoute(async (req, res) => {
    if (!sendMail) return res.status(503).json({ error: 'Email delivery is temporarily unavailable.' });
    if (!req.user.emailVerified) await emailLink(req.user.emailKey, 'verify');
    res.json({ ok: true });
  }));
  router.post('/verify-email', recoveryLimit, asyncRoute(async (req, res) => {
    const secret = req.body?.token;
    if (typeof secret !== 'string' || !/^[\w-]{43}$/.test(secret)) return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    const link = await links.findOneAndDelete({ _id: digest(secret), purpose: 'verify', expiresAt: { $gt: new Date() } });
    if (!link) return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    const result = await users.updateOne({ _id: link.userId, authVersion: link.authVersion }, { $set: { emailVerified: true } });
    if (!result.matchedCount) return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    res.json({ ok: true });
  }));
  router.use((error, _req, res, _next) => { res.status(error.status === 503 ? 503 : 500).json({ error: error.status === 503 ? 'Authentication is busy. Try again shortly.' : 'Unable to complete this request. Please try again.' }); });
  return { router, authenticate, requireUser, publicUser, resolveSession };
}
