import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

test('creator uploads a build, moderator reviews it and another player launches the published game', async ({ browser }, testInfo) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [creator, moderator, player] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  for (const page of [creator, moderator, player]) page.on('pageerror', error => errors.push(error.message));
  async function signIn(page, username) {
    await page.goto('http://127.0.0.1:3040');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email or username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill('Orbit local demo only!');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#account-button')).toHaveText(username);
  }
  const title = `Creator browser check ${Date.now()}`;
  try {
    await signIn(creator, 'DemoCreator'); await signIn(moderator, 'DemoModerator'); await signIn(player, 'DemoPlayer');
    await creator.getByLabel('Game title', { exact: true }).fill(title);
    await creator.getByLabel('Description', { exact: true }).fill('A browser-test creator upload, not a public game listing.');
    await creator.getByRole('button', { name: 'Create draft', exact: true }).click();
    const detail = creator.locator('#project-detail');
    await expect(detail.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await creator.getByLabel('Game package (.zip)', { exact: true }).setInputFiles(resolve('.data/browser-starter.zip'));
    await creator.getByRole('button', { name: 'Upload build', exact: true }).click();
    await expect(detail.locator('.version')).toContainText('ready');
    await detail.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(creator.frameLocator('#game-frame').locator('#status')).toContainText('Welcome, DemoCreator');
    await creator.getByRole('button', { name: 'Close game', exact: true }).click();
    await detail.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await expect(detail.locator('.version')).toContainText('pending');
    await expect(detail.getByRole('button', { name: 'Publish this version' })).toHaveCount(0);
    await player.reload(); await expect(player.locator('#games')).not.toContainText(title);

    await moderator.getByRole('button', { name: 'Refresh moderation queue' }).click();
    const review = moderator.locator('#moderation article').filter({ has: moderator.getByRole('heading', { name: title, exact: true }) });
    await review.getByRole('button', { name: 'Preview build' }).click();
    await expect(moderator.frameLocator('#game-frame').locator('#status')).toContainText('Welcome, DemoModerator');
    await moderator.getByRole('button', { name: 'Close game', exact: true }).click();
    await review.getByLabel('Review reason (creator can see this)').fill('Reviewed the local starter build and its declared capabilities.');
    await review.getByRole('button', { name: 'Approve build' }).click();
    await expect(review).toHaveCount(0);
    await creator.reload();
    await creator.locator('#project-list article').filter({ has: creator.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: 'Manage builds' }).click();
    await detail.getByRole('button', { name: 'Publish this version' }).click();
    await expect(detail).toContainText('Currently published');
    await player.reload();
    const listing = player.locator('#games article').filter({ has: player.getByRole('heading', { name: title, exact: true }) });
    await listing.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(player.frameLocator('#game-frame').locator('#status')).toContainText('Welcome, DemoPlayer');
    await player.locator('#game-frame').scrollIntoViewIfNeeded();
    await player.locator('#play-area').screenshot({ path: testInfo.outputPath('published-game.png') });
    await detail.getByRole('button', { name: 'View launch activity' }).click();
    await expect(detail).toContainText('1 public launch authorizations');
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
