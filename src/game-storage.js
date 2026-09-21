import express from 'express';
import { gameAccess } from './game-access.js';

// One bounded document per player/game/build channel. Games never receive
// database credentials or choose another player's storage namespace.
export function createGameStorage({ db, auth }) {
  const router = express.Router();
  router.use(auth.requireUser);
  router.post('/storage', async (req, res) => {
    const { grantId, operation, value } = req.body || {};
    const access = await gameAccess(db, req.user, grantId, 'storage');
    if (!access) return res.status(403).json({ error: 'Game storage access denied.' });
    const id = `${req.user._id}:${access.project._id}:${access.grant.preview ? access.version._id : 'published'}`;
    if (operation === 'get') {
      const saved = await db.collection('gameSaves').findOne({ _id: id });
      return res.json({ value: saved ? JSON.parse(saved.json) : null });
    }
    if (operation !== 'set' || value === undefined) return res.status(400).json({ error: 'Invalid storage operation.' });
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > 8192) return res.status(413).json({ error: 'Save data must be at most 8 KB.' });
    // JSON stored as a string: untrusted game keys cannot become Mongo operators.
    await db.collection('gameSaves').updateOne({ _id: id }, { $set: {
      userId: req.user._id, projectId: access.project._id, json, updatedAt: new Date(),
    } }, { upsert: true });
    res.json({ saved: true });
  });
  return router;
}
