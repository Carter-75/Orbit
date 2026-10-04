import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const requestSchema = z.object({ userId: z.string().uuid(), apply: z.boolean().default(false),
  confirmation: z.string().optional(), reason: z.string().trim().min(10).max(500) }).strict();
export class ProvisioningError extends Error {}

// Operator-only library: deliberately not mounted as an HTTP route. Database
// access is the authority; confirmation is an accidental-change guard, not auth.
export async function provisionAdmin(db, request) {
  return changeAdminRole(db, request, 'admin');
}
export async function revokeAdmin(db, request) {
  return changeAdminRole(db, request, 'player');
}
async function changeAdminRole(db, request, targetRole) {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) throw new ProvisioningError('Provide a user UUID and a reason of 10–500 characters.');
  const { userId, apply, confirmation, reason } = parsed.data;
  if (apply && confirmation !== userId) throw new ProvisioningError('Confirmation must exactly match the user UUID.');
  const users = db.collection('users');
  const user = await users.findOne({ _id: userId }, { projection: {
    _id: 1, username: 1, role: 1, emailVerified: 1, ageBand: 1, suspended: 1, authVersion: 1,
  } });
  if (!user) throw new ProvisioningError('Account not found. Register and verify the intended account first.');
  if (targetRole === 'admin' && (!user.emailVerified || user.suspended || user.ageBand !== 'adult')) {
    throw new ProvisioningError('A verified, unsuspended adult account is required.');
  }
  if (!['player', 'admin'].includes(user.role) || !Number.isSafeInteger(user.authVersion) || user.authVersion < 0 || user.authVersion >= Number.MAX_SAFE_INTEGER) {
    throw new ProvisioningError('Account authorization state is not supported.');
  }
  const result = { userId, username: user.username, currentRole: user.role, targetRole,
    ...(targetRole === 'player' ? { warning: 'This can remove the last administrator. Recovery requires an authorized database operator.' } : {}) };
  if (user.role === targetRole) return { ...result, status: `already_${targetRole}` };
  if (!apply) return { ...result, status: 'preview', sessionsWillBeRevoked: true };
  // The role, session invalidation and audit event share one atomic write. Do not
  // delete sessions separately: authVersion also revokes links and game grants.
  const changed = await users.updateOne({ _id: userId, role: user.role, authVersion: user.authVersion,
    ...(targetRole === 'admin' ? { emailVerified: true, ageBand: 'adult', suspended: { $ne: true } } : {}) }, {
    $set: { role: targetRole }, $inc: { authVersion: 1 }, $push: { privilegeHistory: {
      id: randomUUID(), action: targetRole === 'admin' ? 'grant_admin' : 'revoke_admin', source: 'operator_cli', at: new Date(),
      fromRole: user.role, toRole: targetRole, reason,
    } },
  }, { writeConcern: { w: 'majority' } });
  if (!changed.modifiedCount) throw new ProvisioningError('Account changed during provisioning. Inspect it again before retrying.');
  return { ...result, status: targetRole === 'admin' ? 'granted' : 'revoked', sessionsRevoked: true };
}
