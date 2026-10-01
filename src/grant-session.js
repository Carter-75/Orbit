// A grant retains only the hashed session identifier, never its cookie token.
// Legacy unbound grants fail closed. Session expiry is checked synchronously;
// authorization never relies on MongoDB's asynchronous TTL cleanup.
export async function grantSessionActive(db, grant) {
  if (typeof grant.sessionId !== 'string' || !/^[a-f0-9]{64}$/.test(grant.sessionId)) return false;
  return Boolean(await db.collection('sessions').findOne({ _id: grant.sessionId, userId: grant.userId,
    authVersion: grant.authVersion, expiresAt: { $gt: new Date() } }, { projection: { _id: 1 } }));
}
