import { Router } from 'express';
import { z } from 'zod';

const querySchema = z.object({ q: z.string().trim().max(80).default(''),
  cursor: z.string().max(768).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict();
const cursorSchema = z.object({ at: z.iso.datetime(), id: z.string().uuid(), q: z.string().max(80) }).strict();
const PAGE_SIZE = 24;
export async function createDiscovery({ db }) {
  const projects = db.collection('projects');
  await projects.createIndex({ status: 1, publishedAt: -1, _id: -1 });
  const router = Router();
  router.get('/', async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Use a search of up to 80 characters and a valid page cursor.' });
    const { q, cursor } = parsed.data;
    let after;
    if (cursor) {
      try {
        after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
        if (after.q !== q) throw new Error('Different search');
      } catch { return res.status(400).json({ error: 'This page cursor is invalid for the current search. Start again.' }); }
    }
    const conditions = [{ status: 'published', suspended: { $ne: true }, publishedAt: { $type: 'date' } }];
    if (q) {
      const literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      conditions.push({ $or: [{ title: { $regex: literal, $options: 'i' } }, { description: { $regex: literal, $options: 'i' } }] });
    }
    if (after) conditions.push({ $or: [{ publishedAt: { $lt: new Date(after.at) } }, { publishedAt: new Date(after.at), _id: { $lt: after.id } }] });
    try {
      const rows = await projects.find({ $and: conditions }, { projection: {
        title: 1, description: 1, genre: 1, ownerName: 1, publishedVersion: 1, publishedAt: 1,
      } }).sort({ publishedAt: -1, _id: -1 }).limit(PAGE_SIZE + 1).maxTimeMS(2000).toArray();
      const hasMore = rows.length > PAGE_SIZE, games = rows.slice(0, PAGE_SIZE), last = games.at(-1);
      const nextCursor = hasMore ? Buffer.from(JSON.stringify({ at: last.publishedAt.toISOString(), id: last._id, q })).toString('base64url') : null;
      res.json({ games, nextCursor });
    } catch (error) {
      if (error.code === 50) return res.status(503).json({ error: 'Search is busy. Try a more specific search or retry shortly.' });
      throw error;
    }
  });
  return router;
}
