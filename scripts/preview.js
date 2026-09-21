import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';

// Explicit developer preview. Production start never selects ephemeral storage.
const mongo = await MongoMemoryServer.create();
const config = readConfig({ MONGODB_URI: mongo.getUri(), PORT: process.env.PORT || '3000' });
const { client, db } = await connectDatabase(config);
const { app } = await createApp({ db, config, sendMail: null });
const server = http.createServer(app);
server.listen(config.port, '127.0.0.1', () => console.log(`Orbit development preview at ${config.appOrigin}; temporary database, email unavailable.`));
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; server.close(async () => { await client.close(); await mongo.stop(); process.exit(0); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
