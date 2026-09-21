import { MongoClient } from 'mongodb';
import { readConfig } from './config.js';
import { createAssetApp } from './assets.js';

try {
  const config = readConfig();
  // Separate read-only Mongo credential supported: no writes or index creation here.
  const client = new MongoClient(config.mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const app = createAssetApp({ db: client.db(config.databaseName), config });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'asset_listening', port: config.port })));
  const stop = () => server.close(async () => { await client.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} catch {
  console.error('Asset startup failed. Check environment and database connectivity.');
  process.exitCode = 1;
}
