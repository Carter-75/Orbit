import { Router } from 'express';
import { z } from 'zod';

const favoriteSchema = z.object({ projectId: z.string().uuid(), saved: z.boolean() }).strict();
export function createLibrary({ db, config, auth }) {
  const router = Router(); router.use(auth.requireUser);
  router.get('/favorites', async (req, res) => {
    const user = await db.collection('users').findOne({ _id: req.user._id }, { projection: { favoriteIds: 1 } });
    const ids = user?.favoriteIds || [];
    const games = await db.collection('projects').find({ _id: { $in: ids }, status: 'published', suspended: { $ne: true } }, {
      projection: { title: 1, description: 1, genre: 1, ownerName: 1, publishedVersion: 1 },
    }).limit(200).toArray();
    res.set('Cache-Control', 'no-store').json({ ids, games });
  });
  router.post('/favorites', async (req, res) => {
    if (req.get('origin') !== config.appOrigin) return res.status(403).json({ error: 'Request origin is not permitted.' });
    const parsed = favoriteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a game and whether to save it.' });
    const { projectId, saved } = parsed.data;
    if (!saved) {
      await db.collection('users').updateOne({ _id: req.user._id }, { $pull: { favoriteIds: projectId } });
      return res.json({ saved: false });
    }
    if (!await db.collection('projects').findOne({ _id: projectId, status: 'published', suspended: { $ne: true } }, { projection: { _id: 1 } })) return res.status(404).json({ error: 'Game unavailable.' });
    // Reservation and insertion are one document operation, including duplicate
    // saves at capacity. No counter can drift during concurrent requests.
    const result = await db.collection('users').updateOne({ _id: req.user._id, $or: [
      { favoriteIds: projectId }, { $expr: { $lt: [{ $size: { $ifNull: ['$favoriteIds', []] } }, 200] } },
    ] }, { $addToSet: { favoriteIds: projectId } });
    if (!result.matchedCount) return res.status(409).json({ error: 'Your library holds up to 200 games. Remove one before adding another.' });
    res.json({ saved: true });
  });
  return router;
}
