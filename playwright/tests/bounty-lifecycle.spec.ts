import { test, expect, chromium } from '@playwright/test';

const MAINTAINER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const CONTRIBUTOR = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY';

test('full bounty lifecycle through the UI', async ({ page, baseURL }) => {
  await page.goto('/');

  // Create a bounty via the form
  await page.getByLabel('Repository').fill('ritik4ever/stellar-bounty-board');
  await page.getByLabel('Issue number').fill('9999');
  await page.getByLabel('Reward').fill('5');
  await page.getByLabel('Issue title').fill('E2E: create and complete bounty');
  await page.getByLabel('Summary').fill('E2E test summary for bounty lifecycle end-to-end.');
  await page.getByLabel('Maintainer address').fill(MAINTAINER);
  await page.getByLabel('Token').fill('XLM');
  await page.getByLabel('Deadline in days').fill('7');
  await page.getByLabel('Labels').fill('help wanted');

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/bounties') && r.status() === 201),
    page.getByRole('button', { name: 'Publish bounty' }).click(),
  ]);

  // Wait for bounty to appear on the board
  await expect(page.getByText('E2E: create and complete bounty')).toBeVisible();

  // Reserve the bounty as a contributor — handle the prompt
  page.on('dialog', async (dialog) => {
    await dialog.accept(CONTRIBUTOR);
  });
  await page.getByRole('button', { name: 'Reserve' }).first().click();
  await expect(page.getByText('Reserved')).toBeVisible();

  // Submit work via the submission modal
  await page.getByRole('button', { name: 'Submit' }).first().click();
  await page.getByPlaceholder('G... (56 chars)').fill(CONTRIBUTOR);
  await page.getByPlaceholder('https://github.com/owner/repo/pull/123').fill('https://github.com/ritik4ever/stellar-bounty-board/pull/1');
  await page.getByRole('button', { name: 'Submit work' }).click();
  await expect(page.getByText('Submitted')).toBeVisible();

  // Release the payout as maintainer (two prompts may appear)
  let promptCount = 0;
  page.on('dialog', async (dialog) => {
    promptCount += 1;
    if (promptCount === 1) await dialog.accept(MAINTAINER);
    else await dialog.accept('');
  });
  await page.getByRole('button', { name: 'Release' }).first().click();

  // Final state: Released
  await expect(page.getByText('Released')).toBeVisible();
});
