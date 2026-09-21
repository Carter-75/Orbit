export async function gameAccess(db, user, grantId, capability) {
  if (!user || typeof grantId !== 'string' || !/^[a-f0-9]{64}$/.test(grantId)) return null;
  const grant = await db.collection('launchGrants').findOne({ _id: grantId, userId: user._id,
    authVersion: user.authVersion, expiresAt: { $gt: new Date() } });
  if (!grant) return null;
  const [project, version] = await Promise.all([
    db.collection('projects').findOne({ _id: grant.projectId, status: { $ne: 'suspended' } }),
    db.collection('versions').findOne({ _id: grant.versionId, projectId: grant.projectId, status: { $ne: 'staging' } }),
  ]);
  if (!project || !version) return null;
  if (grant.preview ? (project.ownerId !== user._id && user.role !== 'admin') : (project.status !== 'published' || version.status !== 'approved')) return null;
  if (capability && !version.manifest.capabilities?.includes(capability)) return null;
  return { grant, project, version };
}
