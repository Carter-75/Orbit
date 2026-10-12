import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const reference = z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9@._:/-]+$/);
const schema = z.object({ userId: z.string().uuid(), operator: reference, caseReference: reference,
  reason: z.string().trim().min(10).max(500), apply: z.boolean().default(false), confirmation: z.string().optional() }).strict();
export class RecoveryError extends Error {}

// Database-operator authority only. No HTTP route, recovery token or password
// reset path calls this function. Attribution is an operator assertion, not auth.
export async function recoverAdminPasskeys(db, request) {
  const parsed = schema.safeParse(request);
  if (!parsed.success) throw new RecoveryError('Provide user UUID, operator, case reference and a reason of 10–500 characters.');
  const { userId, operator, caseReference, reason, apply, confirmation } = parsed.data;
  if (apply && confirmation !== userId) throw new RecoveryError('Confirmation must exactly match the user UUID.');
  const users = db.collection('users');
  const user = await users.findOne({ _id: userId }, { projection: { username: 1, role: 1, authVersion: 1, adminPasskeys: 1 } });
  if (!user) throw new RecoveryError('Account not found.');
  if (!['admin', 'player'].includes(user.role) || !Number.isSafeInteger(user.authVersion) || user.authVersion < 0 || user.authVersion >= Number.MAX_SAFE_INTEGER ||
    (user.adminPasskeys !== undefined && !Array.isArray(user.adminPasskeys))) throw new RecoveryError('Unsupported account authorization state.');
  const count = user.adminPasskeys?.length || 0;
  const result = { userId, username: user.username, currentRole: user.role, targetRole: 'player', passkeysToRemove: count,
    warning: 'Removes administrator access, including the last administrator. Regrant requires a separate verified operator decision.' };
  if (user.role === 'player' && !count) return { ...result, status: 'already_recovered' };
  if (!apply) return { ...result, status: 'preview', sessionsWillBeRevoked: true };
  const changed = await users.updateOne({ _id: userId, role: user.role, authVersion: user.authVersion,
    adminPasskeys: user.adminPasskeys === undefined ? { $exists: false } : { $eq: user.adminPasskeys } }, {
    $set: { role: 'player' }, $unset: { adminPasskeys: '' }, $inc: { authVersion: 1 },
    $push: { privilegeHistory: { id: randomUUID(), action: 'recover_admin_passkeys', source: 'operator_cli',
      operator, caseReference, reason, at: new Date(), fromRole: user.role, toRole: 'player', removedCredentialCount: count } },
  }, { writeConcern: { w: 'majority' } });
  if (!changed.modifiedCount) throw new RecoveryError('Account or passkeys changed during recovery. Inspect again before retrying.');
  return { ...result, status: 'recovered', sessionsRevoked: true };
}
