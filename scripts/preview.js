import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { createAssetApp } from '../src/assets.js';
import { attachRealtime } from '../src/realtime.js';
import { seedDemo } from './demo-seed.js';

// Explicit developer preview. Production start never selects ephemeral storage.
const mongo = await MongoMemoryServer.create();
const port = Number(process.env.PORT || 3000);
const config = readConfig({ MONGODB_URI: mongo.getUri(), PORT: String(port), APP_ORIGIN: `http://127.0.0.1:${port}`, ASSET_ORIGIN: `http://127.0.0.1:${port + 1}` });
const { client, db } = await connectDatabase(config);
const { app, auth } = await createApp({ db, config, sendMail: null });
const demoFlag = process.argv.indexOf('--demo-package');
if (demoFlag !== -1) {
  if (!process.argv[demoFlag + 1]) throw new Error('Provide the local starter ZIP path.');
  await seedDemo(db, process.argv[demoFlag + 1]);
}
const server = http.createServer(app);
const assetServer = http.createServer(createAssetApp({ db, config }));
const realtime = attachRealtime({ server, db, config, auth });
assetServer.listen(port + 1, '127.0.0.1');
server.listen(config.port, '127.0.0.1', () => console.log(`Orbit development preview at ${config.appOrigin}; temporary database, email unavailable.`));
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true; realtime.close();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => assetServer.close(resolve))]);
  await client.close(); await mongo.stop(); process.exit(0);
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
