import express from 'express';
import { createHash } from 'node:crypto';

export function createAssetApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src ${config.assetOrigin} 'unsafe-inline' 'unsafe-eval'; style-src ${config.assetOrigin} 'unsafe-inline'; img-src ${config.assetOrigin} data: blob:; media-src ${config.assetOrigin} blob:; font-src ${config.assetOrigin} data:; connect-src ${config.assetOrigin}; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${config.appOrigin}`,
    }); next();
  });
  app.get('/health/ready', async (_req, res) => {
    try { await db.command({ ping: 1 }); res.json({ status: 'ready' }); }
    catch { res.status(503).json({ status: 'database unavailable' }); }
  });
  app.get('/play/:ticket/*file', async (req, res) => {
    const ticket = req.params.ticket;
    if (!/^[\w-]{43}$/.test(ticket)) return res.sendStatus(404);
    const grant = await db.collection('launchGrants').findOne({
      _id: createHash('sha256').update(ticket).digest('hex'), expiresAt: { $gt: new Date() },
    });
    if (!grant) return res.sendStatus(404);
    const project = await db.collection('projects').findOne({ _id: grant.projectId, status: { $ne: 'suspended' } });
    if (!project) return res.sendStatus(404);
    const user = await db.collection('users').findOne({ _id: grant.userId, authVersion: grant.authVersion, suspended: { $ne: true } });
    if (!user) return res.sendStatus(404);
    const version = await db.collection('versions').findOne({ _id: grant.versionId, projectId: project._id });
    if (!version || version.status === 'staging') return res.sendStatus(404);
    if (!grant.preview && (project.status !== 'published' || version.status !== 'approved')) return res.sendStatus(404);
    if (grant.preview && user._id !== project.ownerId && user.role !== 'admin') return res.sendStatus(404);
    const path = Array.isArray(req.params.file) ? req.params.file.join('/') : req.params.file;
    const asset = await db.collection('assets').findOne({ versionId: grant.versionId, path });
    if (!asset) return res.sendStatus(404);
    res.type(asset.mime).send(Buffer.from(asset.content.buffer));
  });
  app.use((_req, res) => res.sendStatus(404));
  app.use((_error, _req, res, _next) => res.status(500).send('Asset unavailable'));
  return app;
}
