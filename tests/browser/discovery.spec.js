import { test, expect } from '@playwright/test';

test('discovery loads beyond its first page and searches the complete catalog', async ({ page }, testInfo) => {
  await page.goto('/');
  const cards = page.locator('#games article'), search = page.getByRole('searchbox', { name: 'Search games' });
  await expect(cards).toHaveCount(24);
  await expect(page.locator('#games')).not.toContainText('Discovery fixture 030');
  await page.getByRole('button', { name: 'Load more games', exact: true }).click();
  await expect(cards).toHaveCount(31);
  await expect(page.locator('#games')).toContainText('Discovery fixture 030');
  await expect(page.getByRole('button', { name: 'Load more games', exact: true })).toBeHidden();
  await search.fill('Discovery fixture 030');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Discovery fixture 030');
  await search.fill('.*');
  await expect(cards).toHaveCount(0); await expect(page.locator('#games')).toContainText('No matching games yet.');
  await search.fill(''); await expect(cards).toHaveCount(24);
  await expect(page.getByRole('button', { name: 'Load more games', exact: true })).toBeVisible();
  await search.fill('Discovery fixture 001'); await search.fill('Discovery fixture 030');
  await expect(cards).toHaveCount(1); await expect(cards.first()).toContainText('Discovery fixture 030');
  await page.locator('#discover').screenshot({ path: testInfo.outputPath('catalog-search.png') });
});
