import { test, expect } from '@playwright/test';
import {
  readFreighterSigningLog,
  resolveLifecycleFixtures,
  installFreighterDouble,
} from '../support/lifecycle-fixtures';
import { installLifecycleApiDouble } from '../support/lifecycle-api-double';

// Resolve once, at module load. A bad network, identity or endpoint throws
// here, so Playwright reports the fixture error before any test can create a
// bounty, connect a wallet, or ask it to sign a release.
const fixtures = resolveLifecycleFixtures();

test('full bounty lifecycle through the UI on testnet doubles', async ({ page }) => {
  const api = await installLifecycleApiDouble(page, fixtures);
  await installFreighterDouble(page, fixtures);

  await page.goto('/');

  // Create a bounty via the form
  await page.getByLabel('Repository').fill('ritik4ever/stellar-bounty-board');
  await page.getByLabel('Issue #').fill('4242');
  await page.getByLabel('Title').fill('E2E: create and complete bounty');
  await page.getByTestId('bounty-reward-input').fill('5');
  await page.getByLabel('Asset').selectOption('XLM');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/bounties' &&
        response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Bounty' }).click(),
  ]);

  await expect(page.getByText('E2E: create and complete bounty')).toBeVisible();
  await expect(page.getByTestId('bounty-card-status-pill').first()).toHaveText('Open');

  // Reserve as the validated contributor identity
  page.once('dialog', (dialog) => {
    void dialog.accept(fixtures.contributor);
  });
  const [reserveResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/reserve')),
    page.getByTestId('action-button-reserve').first().click(),
  ]);
  expect(reserveResponse.status()).toBe(200);
  await expect(page.getByTestId('bounty-card-status-pill').first()).toHaveText('Reserved');

  // Submit work: the checklist must be completed before submission is enabled
  await page.getByTestId('action-button-submit').first().click();
  await page.getByPlaceholder('G... (56 chars)').fill(fixtures.contributor);
  await page
    .getByPlaceholder('https://github.com/owner/repo/pull/123')
    .fill('https://github.com/ritik4ever/stellar-bounty-board/pull/1');
  for (const label of [
    'PR is linked to the correct issue',
    'PR description explains the changes',
    'All CI checks pass',
  ]) {
    await page.getByRole('checkbox', { name: label }).click();
  }

  const [submitResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/submit')),
    page.getByRole('button', { name: 'Submit work' }).click(),
  ]);
  expect(submitResponse.status()).toBe(200);
  await expect(page.getByTestId('bounty-card-status-pill').first()).toHaveText('Submitted');

  // Release the payout. The transaction hash prompt is optional in the double.
  page.once('dialog', (dialog) => {
    void dialog.accept('');
  });
  const [releaseResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/release')),
    page.getByTestId('action-button-release').first().click(),
  ]);
  expect(releaseResponse.status()).toBe(200);
  await expect(page.getByTestId('bounty-card-status-pill').first()).toHaveText('Released');

  // The wallet was asked to sign exactly one release payload for the
  // maintainer identity the fixtures authorized.
  const signingLog = await readFreighterSigningLog(page);
  expect(signingLog).toHaveLength(1);
  expect(JSON.parse(signingLog[0]!)).toMatchObject({
    action: 'release',
    maintainer: fixtures.maintainer,
    bountyId: api.bounties[0]!.id,
  });

  // Every transition was attributed to a validated fixture identity.
  const reserveRequest = api.requests.find((request) => request.path.endsWith('/reserve'));
  expect(reserveRequest?.body).toMatchObject({ contributor: fixtures.contributor });

  const submitRequest = api.requests.find((request) => request.path.endsWith('/submit'));
  expect(submitRequest?.body).toMatchObject({ contributor: fixtures.contributor });

  const releaseRequest = api.requests.find((request) => request.path.endsWith('/release'));
  expect(releaseRequest?.headers['x-stellar-public-key']).toBe(fixtures.maintainer);
  expect(releaseRequest?.body).toMatchObject({
    action: 'release',
    maintainer: fixtures.maintainer,
  });

  expect(api.bounties[0]!.status).toBe('released');
});
