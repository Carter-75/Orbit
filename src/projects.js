import { Router } from 'express';
import multer from 'multer';
import { Binary } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { validatePackage, PACKAGE_LIMITS } from './packages.js';
import { readAnalytics } from './analytics.js';

const PROJECT_LIMIT = 20, VERSION_LIMIT = 20, VALIDATION_LIMIT = 2;
let activeUploads = 0;
const projectSchema = z.object({ title: z.string().trim().min(1).max(80), description: z.string().trim().max(2000).default(''), genre: z.enum(['adventure', 'action', 'racing', 'puzzle', 'social', 'strategy', 'sports', 'other']).default('other') }).strict();
const selectionSchema = z.object({ versionId: z.string().uuid() }).strict();
const run = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const failure = (status, message) => Object.assign(new Error(message), { status });
const ownerFilter = req => ({ _id: req.params.id, ownerId: req.user._id });
const writableFilter = req => ({ ...ownerFilter(req), suspended: { $ne: true }, status: { $ne: 'suspended' } });
const view = document => { const { _id, ...data } = document; return { id: _id, ...data }; };

/** Mount after auth.authenticate; the router also enforces its own mutation origin check. */
export async function createProjects({ db, config = {}, auth }) {
  const projects = db.collection('projects'), versions = db.collection('versions'), assets = db.collection('assets'), users = db.collection('users');
  await Promise.all([
    projects.createIndex({ ownerId: 1, createdAt: -1 }),
    versions.createIndex({ projectId: 1, createdAt: -1 }),
    assets.createIndex({ versionId: 1, path: 1 }, { unique: true }),
  ]);
  const router = Router(), origin = new URL(config.appOrigin || 'http://localhost:3000').origin;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PACKAGE_LIMITS.compressed, files: 1, fields: 0, parts: 1, fieldNameSize: 32 } }).single('package');
  router.use(auth.requireUser);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin is not permitted.' });
      if (!req.user.emailVerified || req.user.suspended) return res.status(403).json({ error: 'Verify your email before creating or changing projects.' });
    }
    next();
  });
  router.get('/', run(async (req, res) => {
    res.json({ projects: (await projects.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).limit(PROJECT_LIMIT).toArray()).map(view) });
  }));
  router.post('/', run(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) throw failure(400, 'Enter a title, description, and supported genre.');
    // Atomic reservation prevents parallel requests from bypassing the creator quota.
    const reserved = await users.updateOne({ _id: req.user._id, emailVerified: true, suspended: { $ne: true }, $or: [{ projectCount: { $lt: PROJECT_LIMIT } }, { projectCount: { $exists: false } }] }, { $inc: { projectCount: 1 } });
    if (!reserved.modifiedCount) throw failure(409, 'Creator project limit reached or account no longer eligible.');
    const project = { _id: randomUUID(), ownerId: req.user._id, ...parsed.data, status: 'draft', publishedVersion: null, versionCount: 0, createdAt: new Date(), updatedAt: new Date() };
    try { await projects.insertOne(project); }
    catch (error) { await users.updateOne({ _id: req.user._id }, { $inc: { projectCount: -1 } }); throw error; }
    res.status(201).json({ project: view(project) });
  }));
  router.use('/:id', run(async (req, _res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw failure(404, 'Project not found.');
    const project = await projects.findOne(ownerFilter(req));
    if (!project) throw failure(404, 'Project not found.');
    if (!['GET', 'HEAD'].includes(req.method) && (project.suspended || project.status === 'suspended')) throw failure(403, 'This project is suspended.');
    req.project = project; next();
  }));
  router.get('/:id', run(async (req, res) => {
    const builds = await versions.find({ projectId: req.project._id, ownerId: req.user._id }).sort({ createdAt: -1 }).limit(VERSION_LIMIT).toArray();
    res.json({ project: view(req.project), versions: builds.map(view) });
  }));
  router.get('/:id/analytics', run(async (req, res) => {
    res.json(await readAnalytics(db, req.project._id));
  }));
  router.post('/:id/versions', run(async (req, res) => {
    if (activeUploads >= VALIDATION_LIMIT) throw failure(503, 'Upload processing is busy. Try again shortly.');
    activeUploads++;
    let claimed = false, versionId;
    try {
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (!req.file) throw failure(400, 'Attach one ZIP file in the package field.');
      const { manifest, files } = await validatePackage(req.file.buffer);
      const claim = await projects.updateOne({ ...writableFilter(req), versionCount: { $lt: VERSION_LIMIT } }, { $inc: { versionCount: 1 }, $set: { updatedAt: new Date() } });
      if (!claim.modifiedCount) throw failure(409, 'Version limit reached or project is no longer writable.');
      claimed = true; versionId = randomUUID();
      const version = { _id: versionId, projectId: req.params.id, ownerId: req.user._id, status: 'staging', manifest, fileCount: files.length, totalBytes: files.reduce((total, file) => total + file.content.length, 0), createdAt: new Date() };
      await versions.insertOne(version);
      await assets.insertMany(files.map(file => ({ _id: randomUUID(), versionId, projectId: req.params.id, path: file.path, mime: file.mime, content: new Binary(file.content) })), { ordered: true });
      const eligible = await projects.updateOne(writableFilter(req), { $set: { updatedAt: new Date() } });
      if (!eligible.matchedCount) throw failure(409, 'Project changed while uploading. Try again.');
      const finalized = await versions.updateOne({ _id: versionId, status: 'staging' }, { $set: { status: 'ready', completedAt: new Date() } });
      if (!finalized.modifiedCount) throw failure(409, 'Version could not be finalized.');
      claimed = false;
      res.status(201).json({ version: view({ ...version, status: 'ready' }) });
    } catch (error) {
      if (claimed) {
        // Failed builds never become playable. A staging record is retained if cleanup fails.
        try {
          await assets.deleteMany({ versionId });
          await versions.deleteOne({ _id: versionId, status: 'staging' });
          await projects.updateOne(ownerFilter(req), { $inc: { versionCount: -1 } });
        } catch { /* Preserve the staging record/quota if storage cleanup is unavailable. */ }
      }
      throw error;
    } finally { activeUploads--; delete req.file; }
  }));
  router.post('/:id/versions/:versionId/submit', run(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.versionId).success) throw failure(404, 'Version not found.');
    const eligible = await projects.findOne(writableFilter(req));
    if (!eligible) throw failure(403, 'Project is not writable.');
    const version = await versions.findOneAndUpdate({ _id: req.params.versionId, projectId: req.params.id, ownerId: req.user._id, status: { $in: ['ready', 'rejected'] } }, { $set: { status: 'pending', submittedAt: new Date() }, $unset: { reviewReason: '', reviewedAt: '', reviewedBy: '' } }, { returnDocument: 'after' });
    if (!version) throw failure(409, 'Only completed, unapproved versions can be submitted.');
    await projects.updateOne({ ...writableFilter(req), publishedVersion: null }, { $set: { status: 'review', updatedAt: new Date() } });
    res.json({ version: view(version) });
  }));
  const selectVersion = run(async (req, res) => {
    const parsed = selectionSchema.safeParse(req.body);
    if (!parsed.success) throw failure(400, 'Select a valid version.');
    const version = await versions.findOne({ _id: parsed.data.versionId, projectId: req.params.id, ownerId: req.user._id, status: 'approved' });
    if (!version) throw failure(409, 'This version has not been approved for publishing.');
    const project = await projects.findOneAndUpdate(writableFilter(req), { $set: { publishedVersion: version._id, status: 'published', publishedAt: new Date(), updatedAt: new Date() } }, { returnDocument: 'after' });
    if (!project) throw failure(403, 'Project is not writable.');
    res.json({ project: view(project) });
  });
  router.post('/:id/publish', selectVersion);
  router.post('/:id/rollback', selectVersion);
  router.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Upload one ZIP package, up to 10 MB, with no extra form fields.' });
    const status = [400, 403, 404, 409, 413, 503].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: status === 500 ? 'Unable to complete this project request.' : error.message });
  });
  return router;
}
