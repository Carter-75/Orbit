import { test, expect } from '@playwright/test';

test('invitation entry is labeled, masked and cleared when switching back to sign-in', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const invitation = page.getByLabel('Invitation code (if invited)', { exact: false });
  await expect(invitation).toBeHidden();
  await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
  await expect(invitation).toBeVisible(); await expect(invitation).toHaveAttribute('type', 'password');
  await invitation.fill('synthetic-test-code');
  await page.locator('#auth-dialog').screenshot({ path: testInfo.outputPath('private-invitation-form.png') });
  await page.getByRole('button', { name: 'Already here? Sign in', exact: true }).click();
  await expect(invitation).toBeHidden(); await expect(invitation).toHaveValue('');
  await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
  await expect(invitation).toHaveValue('');
});

for (const settings of [
  { name: 'desktop-dark-preference', viewport: { width: 1280, height: 720 }, colorScheme: 'dark' },
  { name: 'narrow-mobile', viewport: { width: 320, height: 568 }, colorScheme: 'light' },
]) {
  test(`registration dialog contrast, reflow and keyboard access: ${settings.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(settings.viewport); await page.emulateMedia({ colorScheme: settings.colorScheme });
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'Create your account ↗', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Find your orbit.', exact: true });
    await expect(dialog).toBeVisible();
    const metrics = await dialog.evaluate(node => {
      const style = getComputedStyle(node), helper = getComputedStyle(node.querySelector('small'));
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const contrast = color => {
        const a = luminance(color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const box = node.getBoundingClientRect();
      return { contrast: contrast(style.color), helperContrast: contrast(helper.color),
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    expect(metrics.contrast).toBeGreaterThanOrEqual(4.5); expect(metrics.helperContrast).toBeGreaterThanOrEqual(4.5);
    expect(metrics.left).toBeGreaterThanOrEqual(0); expect(metrics.right).toBeLessThanOrEqual(settings.viewport.width);
    expect(metrics.top).toBeGreaterThanOrEqual(0); expect(metrics.bottom).toBeLessThanOrEqual(settings.viewport.height);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    const invitation = page.getByLabel('Invitation code (if invited)', { exact: false });
    await invitation.focus(); await invitation.fill('synthetic-keyboard-test');
    await page.keyboard.press('Tab'); await expect(page.locator('#auth-submit')).toBeFocused();
    await expect(page.locator('#auth-submit')).toBeInViewport();
    await page.keyboard.press('Tab'); await expect(page.locator('#toggle-auth')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.locator('#forgot')).toBeFocused();
    await expect(page.locator('#forgot')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`${settings.name}-account-controls.png`) });
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
  });
}
