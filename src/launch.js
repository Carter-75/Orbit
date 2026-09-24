import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { recordLaunch } from './analytics.js';

export async function createLaunch({ db, config, auth }) {
  await db.collection('launchGrants').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const router = Router();
  router.post('/:projectId/launch', auth.requireUser, async (req, res) => {
    const project = await db.collection('projects').findOne({ _id: req.params.projectId });
    if (!project || project.status === 'suspended') return res.status(404).json({ error: 'Game unavailable.' });
    const preview = req.body.preview === true;
    if (preview && req.user._id !== project.ownerId && req.user.role !== 'admin') return res.sendStatus(403);
    if (!preview && project.status !== 'published') return res.status(404).json({ error: 'Game is not published.' });
    const versionId = preview ? req.body.versionId : project.publishedVersion;
    if (typeof versionId !== 'string') return res.status(400).json({ error: 'Choose a game version.' });
    const version = await db.collection('versions').findOne({ _id: versionId, projectId: project._id, status: { $ne: 'staging' } });
    if (!version || (!preview && version.status !== 'approved')) return res.status(404).json({ error: 'Build unavailable.' });
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60000);
    await db.collection('launchGrants').insertOne({ _id: createHash('sha256').update(ticket).digest('hex'),
      projectId: project._id, versionId, userId: req.user._id, authVersion: req.user.authVersion, preview, expiresAt });
    await recordLaunch(db, { projectId: project._id, ownerId: project.ownerId, user: req.user, preview });
    res.json({ grantId: createHash('sha256').update(ticket).digest('hex'), url: `${config.assetOrigin}/play/${ticket}/${version.manifest.entry}`, expiresAt, manifest: version.manifest });
  });
  return router;
}
