// Counts authorization grants issued, not loaded games, engagement, distinct
// people, revenue, or ad impressions. No player identifiers are retained here.
export async function recordLaunch(db, { projectId, ownerId, user, preview }, now = new Date()) {
  if (preview || user._id === ownerId || user.role === 'admin') return;
  const day = now.toISOString().slice(0, 10);
  const expiresAt = new Date(`${day}T00:00:00.000Z`); expiresAt.setUTCDate(expiresAt.getUTCDate() + 90);
  const filter = { _id: `${projectId}:${day}` };
  const update = { $inc: { launchGrants: 1 }, $setOnInsert: { projectId, day, expiresAt } };
  try { await db.collection('gameMetrics').updateOne(filter, update, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; await db.collection('gameMetrics').updateOne(filter, update); }
}
export async function readAnalytics(db, projectId, now = new Date()) {
  const start = new Date(now); start.setUTCDate(start.getUTCDate() - 29);
  const firstDay = start.toISOString().slice(0, 10), lastDay = now.toISOString().slice(0, 10);
  const stored = await db.collection('gameMetrics').find({ projectId, day: { $gte: firstDay, $lte: lastDay } }, { projection: { day: 1, launchGrants: 1 } }).toArray();
  const byDay = new Map(stored.map(row => [row.day, row.launchGrants])); const days = [];
  for (let n = 0; n < 30; n++) { const date = new Date(start); date.setUTCDate(date.getUTCDate() + n); const day = date.toISOString().slice(0, 10); days.push({ day, launchGrants: byDay.get(day) || 0 }); }
  return { metric: 'public_launch_grants', description: 'Launch authorizations issued, not confirmed plays. Excludes previews, owner and administrator activity.', days,
    total: days.reduce((sum, day) => sum + day.launchGrants, 0) };
}
