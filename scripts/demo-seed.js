import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Binary } from 'mongodb';
import { hashPassword } from '../src/auth.js';
import { validatePackage } from '../src/packages.js';

// Only called by the explicit ephemeral loopback preview, never production.
export async function seedDemo(db, packagePath, { catalogFixtures = false } = {}) {
  const passwordHash = await hashPassword('Orbit local demo only!');
  const users = ['DemoCreator', 'DemoPlayer', 'DemoModerator'].map((username, index) => ({
    _id: randomUUID(), username, usernameKey: username.toLowerCase(), email: `${username.toLowerCase()}@example.test`,
    emailKey: `${username.toLowerCase()}@example.test`, passwordHash, authVersion: 0, emailVerified: true,
    role: index === 2 ? 'admin' : 'player', ageBand: 'adult', avatar: index ? 'blue' : 'teal', createdAt: new Date(),
  }));
  await db.collection('users').insertMany(users);
  const { manifest, files } = await validatePackage(await readFile(packagePath));
  const projectId = randomUUID(), versionId = randomUUID();
  await db.collection('projects').insertOne({ _id: projectId, ownerId: users[0]._id, ownerName: users[0].username,
    title: manifest.title, description: 'Local starter demo: collect stars and explore together. Not a live listing.', genre: 'social',
    status: 'published', publishedVersion: versionId, versionCount: 1, createdAt: new Date(), publishedAt: new Date(),
  });
  await db.collection('versions').insertOne({ _id: versionId, projectId, ownerId: users[0]._id, status: 'approved',
    manifest, totalBytes: files.reduce((n, file) => n + file.content.length, 0), createdAt: new Date(),
  });
  await db.collection('assets').insertMany(files.map(file => ({ _id: randomUUID(), projectId, versionId, path: file.path, mime: file.mime, content: new Binary(file.content) })));
  if (catalogFixtures) {
    // Explicit automated-test catalog, never production activity or analytics.
    // Each fixture is a playable independently stored copy of the validated starter.
    for (let index = 1; index <= 30; index++) {
      const fixtureId = randomUUID(), buildId = randomUUID(), at = new Date(Date.now() - 3600000 - index * 1000);
      await db.collection('projects').insertOne({ _id: fixtureId, ownerId: users[0]._id,
        title: `Discovery fixture ${String(index).padStart(3, '0')}`, description: 'Disposable browser-test game, not a live listing.',
        genre: 'other', status: 'published', publishedVersion: buildId, versionCount: 1, createdAt: at, publishedAt: at });
      await db.collection('versions').insertOne({ _id: buildId, projectId: fixtureId, ownerId: users[0]._id,
        status: 'approved', manifest, totalBytes: files.reduce((n, file) => n + file.content.length, 0), createdAt: at });
      await db.collection('assets').insertMany(files.map(file => ({ _id: randomUUID(), projectId: fixtureId,
        versionId: buildId, path: file.path, mime: file.mime, content: new Binary(file.content) })));
    }
  }
  console.log('LOCAL DEMO ONLY: DemoCreator, DemoPlayer, DemoModerator / password: Orbit local demo only!');
}
