import { test, expect } from '@playwright/test';
import http from 'node:http';
import { resolve } from 'node:path';

test('an actually uploaded hostile game cannot access platform state or escape its declared capabilities', async ({ browser }, testInfo) => {
  const hits = [], sink = http.createServer((req, res) => { hits.push({ method: req.method, path: req.url }); res.end('Synthetic loopback sink'); });
  await new Promise((resolve, reject) => { sink.once('error', reject); sink.listen(3042, '127.0.0.1', resolve); });
  const context = await browser.newContext(), page = await context.newPage();
  const errors = [], popups = [], logoutRequests = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('popup', popup => popups.push(popup));
  page.on('request', req => { if (req.url().endsWith('/api/auth/logout')) logoutRequests.push(req); });
  try {
    await page.goto('http://127.0.0.1:3040'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email or username').fill('DemoCreator'); await page.getByLabel('Password', { exact: true }).fill('Orbit local demo only!');
    await page.locator('#auth-submit').click(); await expect(page.locator('#account-button')).toHaveText('DemoCreator');
    await page.getByLabel('Game title', { exact: true }).fill('Local hostile upload fixture');
    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    await page.getByLabel('Game package (.zip)', { exact: true }).setInputFiles(resolve('.data/browser-hostile.zip'));
    await page.getByRole('button', { name: 'Upload build', exact: true }).click();
    await expect(page.locator('#project-detail .version')).toContainText('ready');
    await page.locator('#project-detail').getByRole('button', { name: 'Preview', exact: true }).click();
    const game = page.frameLocator('#game-frame');
    await game.getByRole('button', { name: 'Run boundary probes' }).click();
    await expect(game.locator('#result')).toContainText('"done": true');
    const evidence = JSON.parse(await game.locator('#result').innerText());
    await testInfo.attach('sandbox-results', { body: JSON.stringify({ evidence, sinkHits: hits, reportedLogoutRequests: logoutRequests.length }, null, 2), contentType: 'application/json' });
    for (const key of ['parentDOM', 'cookies', 'localStorage', 'indexedDB', 'topNavigation', 'worker']) expect(evidence[key], key).toBe('SecurityError');
    expect(evidence.popup).toBe('blocked'); expect(evidence.externalFetch).toBe('TypeError'); expect(evidence.platformMutation).toBe('TypeError');
    for (const key of ['identity', 'storage', 'multiplayer']) expect(evidence[key]).toBe('This game did not declare that capability.');
    expect(evidence.handshakeFields).toEqual(['type']);
    // Worker creation is rejected by the opaque-origin check above, before
    // Chromium reaches worker-src; no worker CSP event is expected in that case.
    for (const directive of ['connect-src', 'img-src', 'script-src-elem', 'frame-src']) expect(evidence.violations).toContain(directive);
    expect(hits).toEqual([]); expect(popups).toHaveLength(0);
    // Chromium may report CSP-blocked requests to instrumentation; the real
    // server-side session must still be alive and no cross-origin sink reached.
    const session = await page.request.get('http://127.0.0.1:3040/api/auth/me');
    expect((await session.json()).user.username).toBe('DemoCreator');
    expect(page.url()).toBe('http://127.0.0.1:3040/');
    expect(errors).toEqual([]);
    await page.locator('#play-area').screenshot({ path: testInfo.outputPath('sandbox-probes.png') });
  } finally {
    await context.close(); sink.closeAllConnections(); await new Promise(resolve => sink.close(resolve));
  }
});
