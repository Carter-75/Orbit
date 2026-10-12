import { test, expect } from '@playwright/test';

test('administrator enrolls and verifies a native passkey before moderation, then logout removes access', async ({ page, context }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const primary = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto('http://localhost:3050');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email or username').fill('DemoModerator');
  await page.getByLabel('Password', { exact: true }).fill('Orbit local demo only!');
  await page.locator('#auth-submit').click();
  const security = page.locator('#admin-passkeys'), moderation = page.locator('#moderation');
  await expect(moderation).toContainText('Verify your administrator passkey');
  await expect(security).toContainText('0 passkey(s) enrolled');
  await security.getByLabel('Current password', { exact: false }).fill('Orbit local demo only!');
  await security.getByRole('button', { name: 'Add administrator passkey', exact: true }).click();
  await expect(security).toContainText('1 passkey(s) enrolled');
  await expect(moderation).toContainText('Verify your administrator passkey');
  await security.getByRole('button', { name: 'Verify administrator passkey', exact: true }).click();
  await expect(security).toContainText('Administrator verification is active');
  await expect(moderation.getByRole('heading', { name: 'Build review', exact: true })).toBeVisible();
  // Remove the primary device from this browser before enrolling its independent
  // backup. Current session proof authorizes adding the replacement device.
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: primary.authenticatorId });
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'usb',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await security.getByLabel('Current password', { exact: false }).fill('Orbit local demo only!');
  await security.getByRole('button', { name: 'Add administrator passkey', exact: true }).click();
  await expect(security).toContainText('2 passkey(s) enrolled');
  await security.screenshot({ path: testInfo.outputPath('administrator-passkey-verified.png') });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(security).toHaveCount(0);
  expect((await context.request.get('http://localhost:3050/api/admin/queue')).status()).toBe(401);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email or username').fill('DemoModerator');
  await page.getByLabel('Password', { exact: true }).fill('Orbit local demo only!');
  await page.locator('#auth-submit').click();
  await expect(moderation).toContainText('Verify your administrator passkey');
  await security.getByRole('button', { name: 'Verify administrator passkey', exact: true }).click();
  await expect(moderation.getByRole('heading', { name: 'Build review', exact: true })).toBeVisible();
  await expect(security).toContainText('Administrator verification is active');
  expect(errors).toEqual([]);
});
