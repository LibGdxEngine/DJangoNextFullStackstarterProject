const { chromium } = require('/home/ahmed/.local/state/mobser-cicd/browser/node_modules/playwright-core');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const origin = 'https://mobser-test.2.24.9.126.sslip.io';
  const credentials = JSON.parse(fs.readFileSync('/home/ahmed/.local/state/mobser-cicd/browser-fixture.json', 'utf8'));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  try {
    const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(response.status(), 200);
    await page.getByRole('heading', { name: 'Mobser', exact: true }).waitFor();
    await page.locator('input[type="text"]').fill(credentials.email);
    await page.locator('input[type="password"]').fill(credentials.password);
    await page.getByRole('button', { name: 'Sign In with Email or Phone', exact: true }).click();
    await page.getByText('Active Session', { exact: true }).waitFor({ timeout: 30000 });
    const authenticated = await page.evaluate(async () => {
      const session = await fetch('/api/auth/session').then(r => r.json());
      const result = await fetch('/api/v1/auth/me/', { headers: { Authorization: `Bearer ${session.accessToken}` } });
      return result.status;
    });
    assert.equal(authenticated, 200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Active Session', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign In with Email or Phone', exact: true }).waitFor();
    const anonymous = await page.evaluate(async () => (await fetch('/api/v1/auth/me/')).status);
    assert.equal(anonymous, 401);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/home/ahmed/Documents/Mobser/.omc/research/cicd-browser.png', fullPage: true });
    console.log(JSON.stringify({ homepage: 200, browserLogin: true, authenticatedApi: authenticated, sessionSurvivesReload: true, logout: true, anonymousApi: anonymous, uncaughtErrors: errors.length }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
