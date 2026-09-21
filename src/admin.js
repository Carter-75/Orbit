import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const reasonSchema = z.object({ reason: z.string().trim().min(10).max(2000) }).strict();
const reviewSchema = reasonSchema.extend({ decision: z.enum(['approve', 'reject']) });
const run = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const problem = (status, message) => Object.assign(new Error(message), { status });
const audit = (req, action, reason, details = {}) => ({ id: randomUUID(), actorId: req.user._id, action, reason, at: new Date(), ...details });
function input(schema, body) { const parsed = schema.safeParse(body); if (!parsed.success) throw problem(400, 'Provide a valid decision and a reason of 10–2000 characters.'); return parsed.data; }

/** Moderation state and its immutable-by-API history are appended atomically in the same document. */
export async function createAdmin({ db, config = {}, auth }) {
  const router = Router(), users = db.collection('users'), projects = db.collection('projects'), versions = db.collection('versions');
  const origin = new URL(config.appOrigin || 'http://localhost:3000').origin;
  await versions.createIndex({ status: 1, submittedAt: 1 });
  router.use(auth.requireUser);
  router.use(run(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Recheck the current account so a demoted/suspended admin cannot use an old identity snapshot.
    const eligible = await users.findOne({ _id: req.user._id, role: 'admin', emailVerified: true, suspended: { $ne: true } }, { projection: { _id: 1 } });
    if (!eligible) throw problem(403, 'Administrator access with a verified email is required.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== origin) throw problem(403, 'Request origin is not permitted.');
    next();
  }));
  router.get('/queue', run(async (_req, res) => {
    const queue = await versions.aggregate([
      { $match: { status: 'pending' } }, { $sort: { submittedAt: 1, _id: 1 } }, { $limit: 100 },
      { $lookup: { from: 'projects', localField: 'projectId', foreignField: '_id', pipeline: [{ $project: { title: 1, status: 1, suspended: 1 } }], as: 'project' } },
      { $unwind: '$project' },
      { $project: { _id: 0, id: '$_id', projectId: 1, ownerId: 1, status: 1, manifest: 1, fileCount: 1, totalBytes: 1, submittedAt: 1, projectTitle: '$project.title', projectStatus: '$project.status', projectSuspended: { $eq: ['$project.suspended', true] } } },
    ]).toArray();
    res.json({ versions: queue });
  }));
  router.param('id', (_req, _res, next, id) => next(z.string().uuid().safeParse(id).success ? undefined : problem(404, 'Item not found.')));
  router.get('/cases', run(async (_req, res) => {
    const cases = await db.collection('reports').find({ status: 'open' }, { projection: {
      _id: 1, reporterId: 1, kind: 1, category: 1, targetType: 1, targetId: 1, message: 1, status: 1, createdAt: 1,
    } }).sort({ createdAt: 1 }).limit(100).toArray();
    res.json({ cases: cases.map(({ _id, ...value }) => ({ id: _id, ...value })) });
  }));
  router.post('/cases/:id/resolve', run(async (req, res) => {
    const { reason, publicReply, outcome } = input(reasonSchema.extend({
      publicReply: z.string().trim().min(10).max(2000), outcome: z.enum(['resolved', 'dismissed']),
    }), req.body);
    const event = audit(req, `case.${outcome}`, reason);
    const result = await db.collection('reports').updateOne({ _id: req.params.id, status: 'open' }, {
      $set: { status: outcome, publicReply, resolvedAt: event.at, resolvedBy: req.user._id }, $push: { moderationHistory: event },
    });
    if (!result.modifiedCount) throw problem(409, 'This case was already handled or is unavailable.');
    res.json({ case: { id: req.params.id, status: outcome } });
  }));
  router.post('/versions/:id/review', run(async (req, res) => {
    const { decision, reason } = input(reviewSchema, req.body);
    const candidate = await versions.findOne({ _id: req.params.id, status: 'pending' }, { projection: { projectId: 1 } });
    if (!candidate) throw problem(409, 'This version is no longer awaiting review.');
    const project = await projects.findOne({ _id: candidate.projectId, status: { $ne: 'suspended' }, suspended: { $ne: true } }, { projection: { _id: 1 } });
    if (!project) throw problem(409, 'The project is unavailable or suspended.');
    const event = audit(req, `version.${decision}`, reason, { fromStatus: 'pending', toStatus: decision === 'approve' ? 'approved' : 'rejected' });
    const version = await versions.findOneAndUpdate({ _id: req.params.id, projectId: candidate.projectId, status: 'pending' }, {
      $set: { status: event.toStatus, reviewReason: reason, reviewedAt: event.at, reviewedBy: req.user._id }, $push: { moderationHistory: event },
    }, { returnDocument: 'after', projection: { _id: 1, projectId: 1, status: 1, reviewReason: 1, reviewedAt: 1 } });
    if (!version) throw problem(409, 'Another reviewer already decided this version.');
    res.json({ version: { id: version._id, projectId: version.projectId, status: version.status, reviewReason: version.reviewReason, reviewedAt: version.reviewedAt } });
  }));
  router.post('/projects/:id/suspend', run(async (req, res) => {
    const { reason } = input(reasonSchema, req.body);
    const before = await projects.findOne({ _id: req.params.id, suspended: { $ne: true }, status: { $ne: 'suspended' } }, { projection: { status: 1 } });
    if (!before) throw problem(409, 'Project is unavailable or already suspended.');
    const event = audit(req, 'project.suspend', reason, { fromStatus: before.status, toStatus: 'suspended' });
    const result = await projects.updateOne({ _id: req.params.id, status: before.status, suspended: { $ne: true } }, {
      $set: { status: 'suspended', suspended: true, previousStatus: before.status, suspensionReason: reason, updatedAt: event.at }, $push: { moderationHistory: event },
    });
    if (!result.modifiedCount) throw problem(409, 'Project changed. Review it again.');
    res.json({ project: { id: req.params.id, status: 'suspended', suspended: true } });
  }));
  router.post('/projects/:id/restore', run(async (req, res) => {
    const { reason } = input(reasonSchema, req.body), event = audit(req, 'project.restore', reason, { toStatus: 'draft' });
    const result = await projects.updateOne({ _id: req.params.id, $or: [{ suspended: true }, { status: 'suspended' }] }, {
      $set: { status: 'draft', suspended: false, publishedVersion: null, updatedAt: event.at }, $unset: { suspensionReason: '' }, $push: { moderationHistory: event },
    });
    if (!result.modifiedCount) throw problem(409, 'Project is not suspended.');
    res.json({ project: { id: req.params.id, status: 'draft', suspended: false, publishedVersion: null } });
  }));
  router.post('/users/:id/suspend', run(async (req, res) => {
    const { reason } = input(reasonSchema, req.body);
    if (req.params.id === req.user._id) throw problem(403, 'You cannot suspend your own administrator account.');
    const event = audit(req, 'user.suspend', reason);
    const result = await users.updateOne({ _id: req.params.id, suspended: { $ne: true } }, {
      $set: { suspended: true, suspensionReason: reason, suspendedAt: event.at }, $inc: { authVersion: 1 }, $push: { moderationHistory: event },
    });
    if (!result.modifiedCount) throw problem(409, 'Account is unavailable or already suspended.');
    // Auth resolves against suspended/authVersion on every request, so sessions are already invalid.
    res.json({ user: { id: req.params.id, suspended: true } });
  }));
  router.use((error, _req, res, _next) => {
    const status = [400, 403, 404, 409].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: status === 500 ? 'Unable to complete this moderation action.' : error.message });
  });
  return router;
}
