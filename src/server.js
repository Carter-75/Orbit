import http from 'node:http';
import { readConfig } from './config.js';
import { connectDatabase } from './database.js';
import { createMailer } from './mail.js';
import { createApp } from './app.js';
import { drainMailOutbox } from './auth.js';
import { attachRealtime } from './realtime.js';

try {
  const config = readConfig();
  const { client, db } = await connectDatabase(config);
  const sendMail = createMailer(config);
  const { app, auth } = await createApp({ db, config, sendMail });
  const drain = () => drainMailOutbox({ db, sendMail }).catch(() => console.error('Mail worker unavailable'));
  if (sendMail) await drain();
  const mailTimer = setInterval(() => { if (sendMail) void drain(); }, 30000);
  mailTimer.unref();
  const server = http.createServer(app);
  const realtime = attachRealtime({ server, db, config, auth });
  app.locals.realtime = realtime;
  server.listen(config.port, '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'listening', port: config.port, publicLaunch: config.publicLaunch }));
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    clearInterval(mailTimer);
    realtime.close();
    server.close(async () => { await client.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  // Connection errors may contain the database URI. Do not print arbitrary provider messages.
  console.error(JSON.stringify({ event: 'startup_failed', reason: error.name, hint: 'Check environment settings and MongoDB connectivity.' }));
  process.exitCode = 1;
}
