import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

const schema = z.object({
  kind: z.enum(['report', 'support']),
  category: z.enum(['harassment', 'unsafe-content', 'scam', 'copyright', 'account', 'technical', 'other']),
  targetType: z.enum(['project', 'user']).optional(), targetId: z.string().uuid().optional(),
  message: z.string().trim().min(10).max(2000),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.targetType) !== Boolean(value.targetId) || (value.kind === 'report' && !value.targetId)) ctx.addIssue({ code: 'custom', message: 'Choose the reported game or account.' });
});
const publicCase = value => ({ id: value._id, kind: value.kind, category: value.category, targetType: value.targetType,
  targetId: value.targetId, message: value.message, status: value.status, createdAt: value.createdAt, publicReply: value.publicReply || null });

export async function createSafety({ db, config, auth }) {
  const router = Router(), cases = db.collection('reports');
  await cases.createIndex({ reporterId: 1, createdAt: -1 });
  router.use(auth.requireUser);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'POST' && req.get('origin') !== config.appOrigin) return res.status(403).json({ error: 'Request origin is not permitted.' });
    next();
  });
  router.get('/cases', async (req, res) => {
    const own = await cases.find({ reporterId: req.user._id }).sort({ createdAt: -1 }).limit(50).toArray();
    res.json({ cases: own.map(publicCase) });
  });
  router.post('/cases', rateLimit({ windowMs: 3600000, limit: 10, keyGenerator: req => req.user._id,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'You have sent several requests. Please try again later.' } }), async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a category and provide 10–2000 characters describing the problem.' });
    const input = parsed.data;
    if (input.targetId) {
      // Reports must not become an oracle for private drafts or private account data.
      const filter = input.targetType === 'project' ? { _id: input.targetId, status: 'published' } : { _id: input.targetId };
      const target = await db.collection(input.targetType === 'project' ? 'projects' : 'users').findOne(filter, { projection: { _id: 1 } });
      if (!target) return res.status(404).json({ error: 'The selected item is unavailable. Send a support request instead.' });
    }
    const record = { _id: randomUUID(), reporterId: req.user._id, ...input, status: 'open', createdAt: new Date() };
    await cases.insertOne(record);
    res.status(201).json({ case: publicCase(record) });
  });
  return router;
}
