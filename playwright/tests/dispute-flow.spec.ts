import { test, expect } from '@playwright/test';

const MAINTAINER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const CONTRIBUTOR = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY';
const ARBITER = 'GDXA7K6V6G6TYERZ6KVE6R7V7XDC7J6S4X6G6S6R3VY2A6X6JMXT7RN';

test('full dispute raise to arbiter resolve flow updates UI and final status', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Repository').fill('ritik4ever/stellar-bounty-board');
  await page.getByLabel('Issue number').fill('9998');
  await page.getByLabel('Reward').fill('5');
  await page.getByLabel('Issue title').fill('E2E: dispute flow arbiter resolution');
  await page.getByLabel('Summary').fill('E2E test summary for dispute raise and arbiter resolution flow.');
  await page.getByLabel('Maintainer address').fill(MAINTAINER);
  await page.getByLabel('Token').fill('XLM');
  await page.getByLabel('Deadline in days').fill('7');
  await page.getByLabel('Labels').fill('help wanted');

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/bounties') && r.status() === 201),
    page.getByRole('button', { name: 'Publish bounty' }).click(),
  ]);

  await expect(page.getByText('E2E: dispute flow arbiter resolution')).toBeVisible();

  page.on('dialog', async (dialog) => {
    await dialog.accept(CONTRIBUTOR);
  });
  await page.getByRole('button', { name: 'Reserve' }).first().click();
  await expect(page.getByText('Reserved')).toBeVisible();

  await page.getByRole('button', { name: 'Submit' }).first().click();
  await page.getByPlaceholder('G... (56 chars)').fill(CONTRIBUTOR);
  await page.getByPlaceholder('https://github.com/owner/repo/pull/123').fill('https://github.com/ritik4ever/stellar-bounty-board/pull/2');
  await page.getByRole('button', { name: 'Submit work' }).click();
  await expect(page.getByText('Submitted')).toBeVisible();

  page.on('dialog', async (dialog) => {
    await dialog.accept(CONTRIBUTOR);
  });
  await page.getByRole('button', { name: 'Dispute' }).first().click();
  await expect(page.getByText('Disputed')).toBeVisible();

  await page.getByRole('button', { name: 'Resolve' }).first().click();
  await expect(page.getByText('Released')).toBeVisible();
});
