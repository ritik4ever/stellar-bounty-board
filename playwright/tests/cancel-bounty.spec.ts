import { test, expect, Page, Response } from '@playwright/test';

const MAINTAINER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const CONTRIBUTOR = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY';

async function createOpenBounty(page: Page, title: string, issueNumber: string) {
  await page.goto('/');

  await page.getByLabel('Repository').fill('ritik4ever/stellar-bounty-board');
  await page.getByLabel('Issue number').fill(issueNumber);
  await page.getByLabel('Reward').fill('3');
  await page.getByLabel('Issue title').fill(title);
  await page.getByLabel('Summary').fill('E2E cancellation test summary.');
  await page.getByLabel('Maintainer address').fill(MAINTAINER);
  await page.getByLabel('Token').fill('XLM');
  await page.getByLabel('Deadline in days').fill('7');
  await page.getByLabel('Labels').fill('help wanted');

  await Promise.all([
    page.waitForResponse((r: Response) => r.url().includes('/api/bounties') && r.status() === 201),
    page.getByRole('button', { name: 'Publish bounty' }).click(),
  ]);

  await expect(page.getByText(title)).toBeVisible();
}

test('maintainer can cancel an open bounty before it is reserved', async ({ page }) => {
  const title = 'E2E: cancel open bounty';
  await createOpenBounty(page, title, '9998');

  let promptCount = 0;
  page.on('dialog', async (dialog) => {
    promptCount += 1;
    if (promptCount === 1) {
      await dialog.accept(MAINTAINER);
    } else {
      await dialog.accept('');
    }
  });

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/cancel') && r.ok()),
    page.getByRole('button', { name: 'Cancel' }).first().click(),
  ]);

  // The bounty is marked as refunded after a successful cancellation.
  await expect(page.getByText('Refunded')).toBeVisible();

  // It should no longer appear under the Open status filter.
  await page.getByRole('button', { name: 'open' }).click();
  await expect(page.getByText(title)).not.toBeVisible();
});

test('cancel is not offered for a reserved bounty', async ({ page }) => {
  const title = 'E2E: cancel reserved bounty';
  await createOpenBounty(page, title, '9997');

  page.on('dialog', async (dialog) => {
    await dialog.accept(CONTRIBUTOR);
  });

  await page.getByRole('button', { name: 'Reserve' }).first().click();
  await expect(page.getByText('Reserved')).toBeVisible();

  // The cancel action should be hidden once the bounty is reserved.
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});
