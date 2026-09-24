import { test, expect } from '@playwright/test';

test('two isolated players become friends, share presence and join an invited sandboxed game', async ({ browser }, testInfo) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const creator = await a.newPage(), player = await b.newPage(); const errors = [];
  creator.on('pageerror', error => errors.push(error.message)); player.on('pageerror', error => errors.push(error.message));
  async function signIn(page, username) {
    await page.goto('http://127.0.0.1:3040'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email or username').fill(username); await page.getByLabel('Password', { exact: true }).fill('Orbit local demo only!');
    await page.locator('#auth-submit').click(); await expect(page.locator('#account-button')).toHaveText(username);
  }
  try {
    await signIn(creator, 'DemoCreator'); await signIn(player, 'DemoPlayer');
    await creator.getByLabel('Add by exact username').fill('DemoPlayer');
    await creator.getByRole('button', { name: 'Send friend request' }).click();
    await expect(creator.locator('#social')).toContainText('DemoPlayer');
    await player.getByRole('button', { name: 'Refresh friends', exact: true }).click();
    await player.getByRole('button', { name: 'Accept', exact: true }).click();
    await creator.getByRole('button', { name: 'Refresh friends', exact: true }).click();
    await expect(creator.getByRole('button', { name: 'Remove friend' })).toBeVisible();
    const badge = await creator.locator('#social .avatar-badge').boundingBox();
    expect(badge.width).toBe(42); expect(badge.height).toBe(42);
    const sharing = creator.getByRole('checkbox', { name: 'Share my online status with friends' });
    await expect(sharing).not.toBeChecked(); await sharing.check();
    await expect(sharing).toBeEnabled();
    await player.getByRole('button', { name: 'Refresh friends', exact: true }).click();
    await expect(player.locator('#social').getByText('Online', { exact: true })).toBeVisible();
    await creator.locator('#games article').filter({ has: creator.getByRole('heading', { name: 'Star Garden', exact: true }) }).getByRole('button', { name: 'Play', exact: true }).click();
    const gameA = creator.frameLocator('#game-frame');
    await expect(gameA.locator('#status')).toContainText('Welcome, DemoCreator');
    await gameA.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(gameA.locator('#room-status')).toContainText('1 player');
    await creator.getByRole('button', { name: 'Refresh game invitations' }).click();
    await creator.getByLabel('Friend to invite').selectOption({ label: 'DemoPlayer' });
    await creator.getByRole('button', { name: 'Send game invitation' }).click();
    await expect(creator.locator('#game-invitations')).toContainText('Invitation sent.');
    await player.getByRole('button', { name: 'Refresh game invitations' }).click();
    await player.getByRole('button', { name: 'Join friend', exact: true }).click();
    const gameB = player.frameLocator('#game-frame');
    await expect(gameB.locator('#room-status')).toContainText('2 players');
    await expect(gameA.locator('#room-status')).toContainText('2 players');
    await expect(gameB.locator('#players')).toContainText('DemoCreator');
    await gameB.getByRole('button', { name: 'Say hello', exact: true }).click();
    await expect(gameA.locator('#chat')).toHaveText('DemoPlayer: Hello!');
    await creator.locator('#game-frame').scrollIntoViewIfNeeded();
    await creator.locator('#play-area').screenshot({ path: testInfo.outputPath('invited-room.png') });
    await expect(creator.locator('#game-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    expect(await creator.evaluate(() => { try { document.getElementById('game-frame').contentWindow.document; return false; } catch (error) { return error.name === 'SecurityError'; } })).toBe(true);
    await player.getByRole('button', { name: 'Block', exact: true }).click();
    await expect(player.getByRole('button', { name: 'Unblock', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
