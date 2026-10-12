import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { verifyPassword } from './auth.js';

const completion = z.object({ challengeId: z.string().uuid(), response: z.object({
  id: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/),
}).passthrough() }).strict();
const problem = (status, message) => Object.assign(new Error(message), { status });
const run = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const eligible = user => ({ _id: user._id, role: 'admin', emailVerified: true,
  suspended: { $ne: true }, authVersion: user.authVersion });
const sessionFilter = req => ({ _id: req.authSessionId, userId: req.user._id,
  authVersion: req.user.authVersion, expiresAt: { $gt: new Date() } });

export async function adminMfaActive(db, req) {
  if (!req.user || typeof req.authSessionId !== 'string') return false;
  const session = await db.collection('sessions').findOne({ ...sessionFilter(req),
    adminVerifiedUntil: { $gt: new Date() } }, { projection: { adminVerifiedCredentialId: 1 } });
  if (!session || typeof session.adminVerifiedCredentialId !== 'string') return false;
  return Boolean(await db.collection('users').findOne({ ...eligible(req.user),
    'adminPasskeys.id': session.adminVerifiedCredentialId }, { projection: { _id: 1 } }));
}

// Mounted after auth.authenticate, outside the step-up-protected admin router so
// administrators can complete the ceremony before accessing privileged routes.
export async function createAdminPasskeys({ db, config, auth }) {
  const router = Router(), users = db.collection('users'), sessions = db.collection('sessions');
  const origin = new URL(config.appOrigin).origin, rpID = new URL(origin).hostname;
  if (!origin.startsWith('https:') && !['localhost', '127.0.0.1'].includes(rpID)) throw new Error('Passkeys require HTTPS or loopback development.');
  await users.createIndex({ 'adminPasskeys.id': 1 }, { unique: true, sparse: true });
  router.use(auth.requireUser);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin is not permitted.' });
    next();
  });
  router.use(async (req, res, next) => {
    if (typeof req.authSessionId !== 'string') return res.status(401).json({ error: 'Sign in again.' });
    const user = await users.findOne(eligible(req.user));
    const session = user && await sessions.findOne(sessionFilter(req));
    if (!user || !session) return res.status(403).json({ error: 'Current verified administrator access is required.' });
    req.passkeyUser = user; req.passkeySession = session; next();
  });
  router.get('/', run(async (req, res) => res.json({ enrolled: Boolean(req.passkeyUser.adminPasskeys?.length),
    count: req.passkeyUser.adminPasskeys?.length || 0, verified: await adminMfaActive(db, req) })));
  router.use(rateLimit({ windowMs: 15 * 60000, limit: 12, keyGenerator: req => req.user._id,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many passkey attempts. Try again later.' } }));
  async function saveChallenge(req, type, options, extra = {}) {
    const id = randomUUID();
    const result = await sessions.updateOne(sessionFilter(req), { $set: { adminChallenge: {
      id, type, value: options.challenge, expiresAt: new Date(Date.now() + 5 * 60000), ...extra,
    } } }, { writeConcern: { w: 'majority' } });
    if (!result.matchedCount) throw problem(401, 'Session ended. Sign in again.');
    return { challengeId: id, options };
  }
  async function consume(req, type) {
    const parsed = completion.safeParse(req.body);
    if (!parsed.success) throw problem(400, 'Invalid passkey response.');
    const session = await sessions.findOneAndUpdate({ ...sessionFilter(req), 'adminChallenge.id': parsed.data.challengeId,
      'adminChallenge.type': type, 'adminChallenge.expiresAt': { $gt: new Date() } },
    { $unset: { adminChallenge: '' } }, { returnDocument: 'before', writeConcern: { w: 'majority' } });
    if (!session) throw problem(409, 'Passkey request expired or was already used. Start again.');
    return { challenge: session.adminChallenge, response: parsed.data.response };
  }
  router.post('/register/options', run(async (req, res) => {
    const parsed = z.object({ password: z.string().min(1).max(128) }).strict().safeParse(req.body);
    if (!parsed.success || !await verifyPassword(parsed.data.password, req.passkeyUser.passwordHash)) throw problem(401, 'Confirm your account password.');
    const existing = req.passkeyUser.adminPasskeys || [];
    if (existing.length >= 5) throw problem(409, 'At most five administrator passkeys are supported.');
    if (existing.length && !await adminMfaActive(db, req)) throw problem(403, 'Verify an existing passkey before adding another.');
    const options = await generateRegistrationOptions({ rpName: 'Orbit', rpID,
      userName: req.passkeyUser.username, userID: new TextEncoder().encode(req.user._id),
      attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: existing.map(key => ({ id: key.id })),
    });
    res.json(await saveChallenge(req, 'register', options, { first: existing.length === 0 }));
  }));
  router.post('/register/verify', run(async (req, res) => {
    const { challenge, response } = await consume(req, 'register');
    if (!challenge.first && !await adminMfaActive(db, req)) throw problem(403, 'Verify your existing passkey again.');
    let verification;
    try { verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge.value,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); }
    catch { throw problem(400, 'Passkey registration could not be verified. Start again.'); }
    if (!verification.verified || !verification.registrationInfo) throw problem(400, 'Passkey registration was not verified.');
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const key = { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter, deviceType: credentialDeviceType, backedUp: credentialBackedUp, createdAt: new Date() };
    let saved;
    try {
      saved = await users.updateOne({ ...eligible(req.user),
        ...(challenge.first ? { 'adminPasskeys.0': { $exists: false } } : {}),
        'adminPasskeys.id': { $ne: key.id },
        $expr: { $lt: [{ $size: { $ifNull: ['$adminPasskeys', []] } }, 5] },
      }, { $push: { adminPasskeys: key, privilegeHistory: { id: randomUUID(), action: 'register_admin_passkey',
        actorId: req.user._id, at: new Date() } } }, { writeConcern: { w: 'majority' } });
    } catch (error) { if (error.code === 11000) throw problem(409, 'This passkey is already registered.'); throw error; }
    if (!saved.modifiedCount) throw problem(409, 'Account or passkey enrollment changed. Start again.');
    // Enrollment itself is not a session step-up; authenticate the new key next.
    res.json({ registered: true });
  }));
  router.post('/authenticate/options', run(async (req, res) => {
    const keys = req.passkeyUser.adminPasskeys || [];
    if (!keys.length) throw problem(409, 'Register an administrator passkey first.');
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required',
      allowCredentials: keys.map(key => ({ id: key.id })) });
    res.json(await saveChallenge(req, 'authenticate', options));
  }));
  router.post('/authenticate/verify', run(async (req, res) => {
    const { challenge, response } = await consume(req, 'authenticate');
    const key = req.passkeyUser.adminPasskeys?.find(value => value.id === response.id);
    if (!key) throw problem(400, 'Passkey authentication could not be verified.');
    let verification;
    try { verification = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.value,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')), counter: key.counter },
    }); } catch { throw problem(400, 'Passkey authentication could not be verified. Start again.'); }
    if (!verification.verified) throw problem(400, 'Passkey authentication was not verified.');
    const saved = await users.updateOne({ ...eligible(req.user), adminPasskeys: { $elemMatch: { id: key.id, counter: key.counter } } },
      { $set: { 'adminPasskeys.$.counter': verification.authenticationInfo.newCounter, 'adminPasskeys.$.lastUsedAt': new Date() } }, { writeConcern: { w: 'majority' } });
    if (!saved.matchedCount) throw problem(409, 'Passkey state changed. Try again.');
    const verifiedUntil = new Date(Math.min(Date.now() + 10 * 60000, req.passkeySession.expiresAt.getTime()));
    const updated = await sessions.updateOne(sessionFilter(req), { $set: { adminVerifiedUntil: verifiedUntil, adminVerifiedCredentialId: key.id } }, { writeConcern: { w: 'majority' } });
    if (!updated.matchedCount) throw problem(401, 'Session ended. Sign in again.');
    res.json({ verified: true, verifiedUntil });
  }));
  router.use((error, _req, res, _next) => {
    const status = [400, 401, 403, 409, 429, 503].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: status === 500 ? 'Passkey request failed. Start again.' : error.message });
  });
  return router;
}
