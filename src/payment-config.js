// Live activation deliberately requires a separately reviewed implementation.
// An environment-variable typo must never turn on real-money processing.
export const STRIPE_API_VERSION = '2026-08-26.dahlia';
export function readPaymentConfig(env = process.env) {
  const mode = env.PAYMENTS_MODE || 'disabled';
  if (!['disabled', 'test'].includes(mode)) throw new Error('Payments support disabled or test mode only.');
  if (mode === 'disabled') return { mode };
  if (!/^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('Test payments require a Stripe test secret key.');
  if (!/^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET || '')) throw new Error('Test payments require a webhook signing secret.');
  return { mode, secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, apiVersion: STRIPE_API_VERSION };
}
