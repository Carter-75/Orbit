import { parseArgs } from 'node:util';
import { MongoClient } from 'mongodb';
import { provisionAdmin, revokeAdmin, ProvisioningError } from '../src/admin-provisioning.js';

let client;
try {
  const { values } = parseArgs({ options: {
    user: { type: 'string' }, reason: { type: 'string' }, apply: { type: 'boolean', default: false },
    confirm: { type: 'string' }, help: { type: 'boolean', default: false },
    revoke: { type: 'boolean', default: false },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log('Preview: npm run admin:grant -- --user USER_UUID --reason "Owner access approval"');
    console.log('Apply: add --apply --confirm USER_UUID. Uses MONGODB_URI and MONGODB_DATABASE; never pass secrets as arguments.');
    console.log('Removal: npm run admin:revoke -- --user USER_UUID --reason "Access review decision". Preview first; add --apply --confirm USER_UUID to revoke. This can remove the last administrator.');
  } else {
    if (!values.user || !values.reason) throw new ProvisioningError('Provide --user USER_UUID and --reason. Use --help for usage.');
    if (!/^mongodb(?:\+srv)?:\/\//.test(process.env.MONGODB_URI || '')) throw new ProvisioningError('Set MONGODB_URI securely in the operator environment.');
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const databaseName = process.env.MONGODB_DATABASE || 'orbit';
    const result = await (values.revoke ? revokeAdmin : provisionAdmin)(client.db(databaseName), {
      userId: values.user, reason: values.reason, apply: values.apply, confirmation: values.confirm,
    });
    console.log(JSON.stringify({ database: databaseName, ...result }));
  }
} catch (error) {
  // Provider errors can contain credentials or addresses. Never dump raw errors.
  console.error(error instanceof ProvisioningError ? error.message : 'Provisioning failed. Check arguments, database access and account state; no raw database errors are logged.');
  process.exitCode = 1;
} finally {
  try { await client?.close(); }
  catch { console.error('Database connection cleanup failed.'); process.exitCode = 1; }
}
