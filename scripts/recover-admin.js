import { parseArgs } from 'node:util';
import { MongoClient } from 'mongodb';
import { recoverAdminPasskeys, RecoveryError } from '../src/admin-recovery.js';

let client;
try {
  const { values } = parseArgs({ options: { user: { type: 'string' }, operator: { type: 'string' },
    case: { type: 'string' }, reason: { type: 'string' }, confirm: { type: 'string' },
    apply: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log('Preview: npm run admin:recover -- --user USER_UUID --operator OPERATOR_ID --case CASE_REFERENCE --reason "Verified recovery decision"');
    console.log('Apply: add --apply --confirm USER_UUID. Removes administrator access and all passkeys; revokes sessions. May remove the last admin.');
    console.log('Verify identity out of band and notify the account owner. Separate admin:grant approval is required afterward. Operator identity is asserted, not authenticated by this command.');
    console.log('Uses MONGODB_URI and MONGODB_DATABASE from the secured operator environment. Never pass secrets or identity evidence as arguments.');
  } else {
    if (!/^mongodb(?:\+srv)?:\/\//.test(process.env.MONGODB_URI || '')) throw new RecoveryError('Set MONGODB_URI securely in the operator environment.');
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); await client.connect();
    const database = process.env.MONGODB_DATABASE || 'orbit';
    const result = await recoverAdminPasskeys(client.db(database), { userId: values.user, operator: values.operator,
      caseReference: values.case, reason: values.reason, apply: values.apply, confirmation: values.confirm });
    console.log(JSON.stringify({ database, ...result }));
  }
} catch (error) {
  console.error(error instanceof RecoveryError ? error.message : 'Recovery failed. Check arguments, database access and account state; raw database errors are not logged.'); process.exitCode = 1;
} finally { try { await client?.close(); } catch { console.error('Database connection cleanup failed.'); process.exitCode = 1; } }
