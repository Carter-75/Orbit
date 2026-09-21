import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createAuth } from './auth.js';
import { createLaunch } from './launch.js';
import { createProjects } from './projects.js';
import { createSocial } from './social.js';
import { createAdmin } from './admin.js';
import { createGameStorage } from './game-storage.js';
import { createSafety } from './safety.js';

export async function createApp({ db, config, sendMail }) {
  const app = express();
  app.disable('x-powered-by');
  // Render terminates HTTPS at its proxy; local requests are not proxy-trusted.
  app.set('trust proxy', config.production ? 1 : false);
  app.use((req, res, next) => { req.requestId = randomUUID(); res.set('X-Request-ID', req.requestId); next(); });
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameSrc: [config.assetOrigin],
    objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"],
    upgradeInsecureRequests: config.production ? [] : null,
  } } }));
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try { await db.command({ ping: 1 }); res.json({ status: 'ready' }); }
    catch { res.status(503).json({ status: 'database unavailable' }); }
  });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('origin') !== config.appOrigin) {
      return res.status(403).json({ error: 'This action must originate from Orbit.' });
    }
    res.set('Cache-Control', 'no-store'); next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  const auth = await createAuth({ db, config, sendMail });
  app.post('/api/auth/register', (_req, res, next) => {
    if (config.production && !config.publicLaunch) return res.status(503).json({ error: 'Orbit is not open for new accounts yet.' });
    next();
  });
  app.use('/api/auth', auth.router);
  app.use('/api', auth.authenticate);
  app.use('/api/projects', await createProjects({ db, config, auth }));
  app.use('/api/social', await createSocial({ db, config, auth }));
  app.use('/api/admin', await createAdmin({ db, config, auth }));
  app.use('/api/safety', await createSafety({ db, config, auth }));
  app.use('/api/games', await createLaunch({ db, config, auth }));
  app.use('/api/sdk', createGameStorage({ db, auth }));
  app.get('/api/platform', (_req, res) => res.json({
    name: 'Orbit', minimumAge: 13, publicLaunch: config.publicLaunch,
    capabilities: { email: Boolean(config.emailApiKey && config.emailFrom), ads: false, subscriptions: false },
  }));
  app.get('/api/games', async (_req, res) => {
    const games = await db.collection('projects').find({ status: 'published' }, {
      projection: { title: 1, description: 1, genre: 1, ownerName: 1, publishedVersion: 1 },
    }).sort({ publishedAt: -1 }).limit(60).toArray();
    res.json({ games });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), {
    dotfiles: 'deny', index: 'index.html', redirect: false,
  }));
  app.use((_req, res) => res.status(404).send('Not found'));
  app.use((error, req, res, _next) => {
    const invalid = error.name === 'ZodError' || error.type === 'entity.parse.failed';
    const status = invalid ? 400 : error.status === 413 ? 413 : 500;
    if (status === 500) console.error(JSON.stringify({ event: 'request_failed', requestId: req.requestId, errorType: error.name }));
    res.status(status).json({ error: invalid ? 'Please check the submitted fields.' : status === 413 ? 'Request is too large.' : 'Something went wrong. Please try again.', requestId: req.requestId });
  });
  return { app, auth };
}
