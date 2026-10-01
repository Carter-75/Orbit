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
