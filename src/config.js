import { z } from 'zod';

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = z.coerce.number().int().min(1).max(65535).parse(env.PORT || 3000);
  const appOrigin = new URL(env.APP_ORIGIN || (env.RENDER_EXTERNAL_URL ?? `http://localhost:${port}`)).origin;
  const assetOrigin = new URL(env.ASSET_ORIGIN || 'http://localhost:3001').origin;
  if (appOrigin === assetOrigin) throw new Error('Creator assets require a separate origin.');
  if (production && (!appOrigin.startsWith('https:') || !assetOrigin.startsWith('https:'))) {
    throw new Error('Production origins must use HTTPS.');
  }
  if (!env.MONGODB_URI?.match(/^mongodb(?:\+srv)?:\/\//)) {
    throw new Error('MONGODB_URI must point to a MongoDB database. No temporary production fallback exists.');
  }
  return {
    production, port, appOrigin, assetOrigin,
    mongoUri: env.MONGODB_URI,
    databaseName: env.MONGODB_DATABASE || 'orbit',
    sessionDays: 7,
    publicLaunch: env.PUBLIC_LAUNCH === 'true',
    emailApiKey: env.RESEND_API_KEY || '',
    emailFrom: env.EMAIL_FROM || '',
  };
}
