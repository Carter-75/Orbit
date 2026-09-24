import { MongoClient } from 'mongodb';

export async function connectDatabase(config) {
  const client = new MongoClient(config.mongoUri, { maxPoolSize: 20, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(config.databaseName);
  await Promise.all([
    db.collection('projects').createIndex({ ownerId: 1, createdAt: -1 }),
    db.collection('projects').createIndex({ status: 1, publishedAt: -1 }),
    db.collection('versions').createIndex({ projectId: 1, createdAt: -1 }),
    db.collection('assets').createIndex({ versionId: 1, path: 1 }, { unique: true }),
    db.collection('favorites').createIndex({ userId: 1, projectId: 1 }, { unique: true }),
    db.collection('relationships').createIndex({ from: 1, to: 1 }, { unique: true }),
    db.collection('reports').createIndex({ status: 1, createdAt: -1 }),
    db.collection('audit').createIndex({ createdAt: -1 }),
    db.collection('gameMetrics').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('gameMetrics').createIndex({ projectId: 1, day: 1 }),
  ]);
  return { client, db };
}
