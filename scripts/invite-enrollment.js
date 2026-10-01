import { parseArgs } from 'node:util';
import { MongoClient } from 'mongodb';
import { issueEnrollment, EnrollmentError } from '../src/enrollment.js';
let client;
try {
  const { values } = parseArgs({ options: { email: { type: 'string' }, apply: { type: 'boolean', default: false },
    confirm: { type: 'string' }, help: { type: 'boolean', default: false } }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log('Preview: npm run enrollment:invite -- --email owner@example.com');
    console.log('Issue: add --apply --confirm owner@example.com. Output contains a secret, single-use 24-hour code; share privately, never log or commit it.');
  } else {
    if (!/^mongodb(?:\+srv)?:\/\//.test(process.env.MONGODB_URI || '')) throw new EnrollmentError('Set MONGODB_URI securely in the operator environment.');
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); await client.connect();
    const database = process.env.MONGODB_DATABASE || 'orbit';
    console.log(JSON.stringify({ database, ...await issueEnrollment(client.db(database), {
      email: values.email, apply: values.apply, confirmation: values.confirm,
    }) }));
  }
} catch (error) {
  console.error(error instanceof EnrollmentError ? error.message : 'Invitation failed. Check arguments and database access; raw database errors are not logged.');
  process.exitCode = 1;
} finally { try { await client?.close(); } catch { console.error('Database connection cleanup failed.'); process.exitCode = 1; } }
