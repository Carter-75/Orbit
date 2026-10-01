import { randomBytes, createHash } from 'node:crypto';

export class EnrollmentError extends Error {}
const hash = value => createHash('sha256').update(value).digest('hex');
export function enrollmentEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new EnrollmentError('Provide a valid email address.');
  return value.trim().toLowerCase();
}
export async function issueEnrollment(db, { email, apply = false, confirmation }) {
  const emailKey = enrollmentEmail(email);
  if (apply && confirmation !== emailKey) throw new EnrollmentError('Confirm the exact normalized email address.');
  if (await db.collection('users').findOne({ emailKey }, { projection: { _id: 1 } })) throw new EnrollmentError('An account already exists. Use sign-in or password recovery.');
  if (!apply) return { status: 'preview', email: emailKey, expiresInHours: 24 };
  const code = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 86400000);
  // One current invitation per email. Reissuing invalidates any earlier code.
  await db.collection('enrollments').replaceOne({ _id: hash(emailKey) }, {
    _id: hash(emailKey), tokenHash: hash(code), expiresAt, createdAt: new Date(), status: 'ready',
  }, { upsert: true, writeConcern: { w: 'majority' } });
  return { status: 'issued', email: emailKey, code, expiresAt };
}
export async function enrollmentAvailable(db, email, code) {
  if (typeof code !== 'string' || !/^[\w-]{43}$/.test(code)) return false;
  return Boolean(await db.collection('enrollments').findOne({ _id: hash(enrollmentEmail(email)),
    tokenHash: hash(code), status: 'ready', expiresAt: { $gt: new Date() } }, { projection: { _id: 1 } }));
}
export async function consumeEnrollment(db, email, code, userId) {
  if (typeof code !== 'string' || !/^[\w-]{43}$/.test(code)) return false;
  const result = await db.collection('enrollments').updateOne({ _id: hash(enrollmentEmail(email)),
    tokenHash: hash(code), status: 'ready', expiresAt: { $gt: new Date() } }, {
    $set: { status: 'consumed', consumedAt: new Date(), userId }, $unset: { tokenHash: '' },
  }, { writeConcern: { w: 'majority' } });
  return result.modifiedCount === 1;
}
