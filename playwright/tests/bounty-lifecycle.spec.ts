import { randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext } from '@playwright/test';

// Matches the current creation form's default maintainer.
const MAINTAINER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const CONTRIBUTOR = 'GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF';
const REPOSITORY = 'ritik4ever/stellar-bounty-board';
const PR_URL = `https://github.com/${REPOSITORY}/pull/1`;

async function mockFreighter(context: BrowserContext, publicKey: string) {
  // Only the browser extension is stubbed. Lifecycle requests reach the real
  // backend, using its documented NODE_ENV=test signature-auth bypass.
  await context.addInitScript((address) => {
    window.freighter = {
      isConnected: async () => ({ isConnected: true }),
      getPublicKey: async () => address,
      signMessage: async () => ({ signature: 'e2e-wallet-signature' }),
      getNetwork: async () => ({
        network: 'TESTNET',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }),
      setNetwork: async () => {},
    };
  }, publicKey);
}

test('maintainer and contributor complete the bounty lifecycle through the UI', async ({
  page: maintainer,
  context: maintainerContext,
  browser,
  baseURL,
}) => {
  const contributorContext = await browser.newContext({ baseURL });
  try {
    await mockFreighter(maintainerContext, MAINTAINER);
    await mockFreighter(contributorContext, CONTRIBUTOR);
    const contributor = await contributorContext.newPage();
    const title = `E2E lifecycle ${randomUUID()}`;
    const maintainerCard = maintainer.getByRole('article').filter({
      has: maintainer.getByRole('heading', { name: title, exact: true }),
    });
    const contributorCard = contributor.getByRole('article').filter({
      has: contributor.getByRole('heading', { name: title, exact: true }),
    });

    await test.step('maintainer creates an open bounty', async () => {
      await maintainer.goto('/');
      await expect(maintainer.locator('.freighter-connected')).toContainText('GAAAAA...AWHF');
      await maintainer.getByLabel('Repository', { exact: true }).fill(REPOSITORY);
      await maintainer.getByLabel('Issue #', { exact: true }).fill(String(Date.now()));
      await maintainer.getByLabel('Title', { exact: true }).fill(title);
      await maintainer
        .getByLabel('Summary', { exact: true })
        .fill('Exercise creation, reservation, submission, and release through the dashboard.');
      await maintainer.getByLabel('Reward', { exact: true }).fill('5');
      await maintainer.getByRole('combobox', { name: /^Asset/ }).selectOption('XLM');
      await maintainer.getByRole('button', { name: 'Create Bounty', exact: true }).click();

      await expect(maintainerCard.getByTestId('bounty-card-status-pill')).toHaveText('Open');
      await expect(maintainerCard).toContainText('5 XLM');
      await expect(maintainerCard.getByRole('button', { name: /^Reserve:/ })).toBeEnabled();
    });

    await test.step('a separate contributor session reserves the same bounty', async () => {
      await contributor.goto('/');
      await expect(contributor.locator('.freighter-connected')).toContainText('GBE6AZ...YWSF');
      await expect(contributorCard.getByTestId('bounty-card-status-pill')).toHaveText('Open');
      contributor.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('prompt');
        expect(dialog.message()).toBe('Contributor Stellar address');
        await dialog.accept(CONTRIBUTOR);
      });
      await contributorCard.getByRole('button', { name: /^Reserve:/ }).click();
      await expect(contributorCard.getByTestId('bounty-card-status-pill')).toHaveText('Reserved');
      await expect(contributorCard).toContainText('GBE6AZ...YWSF');
      await expect(contributorCard.getByRole('button', { name: /^Reserve:/ })).toHaveCount(0);

      await maintainer.reload();
      await expect(maintainerCard.getByTestId('bounty-card-status-pill')).toHaveText('Reserved');
    });

    await test.step('contributor submits a PR using the required checklist', async () => {
      await contributorCard.getByRole('button', { name: /^Submit:/ }).click();
      const submission = contributor.getByRole('dialog', { name: 'Submit your work' });
      await expect(submission).toBeVisible();
      await expect(
        submission.getByLabel('Contributor Stellar address', { exact: false })
      ).toHaveValue(CONTRIBUTOR);
      await submission.getByLabel('Pull request or demo URL', { exact: false }).fill(PR_URL);
      await expect(submission.getByLabel('Pull request or demo URL', { exact: false })).toHaveValue(
        PR_URL
      );
      const submit = submission.getByRole('button', { name: 'Submit work', exact: true });
      await expect(submit).toBeDisabled();
      for (const label of [
        'PR is linked to the correct issue',
        'PR description explains the changes',
        'All CI checks pass',
      ]) {
        await submission.getByRole('checkbox', { name: label, exact: true }).check();
      }
      await expect(submit).toBeEnabled();
      await submit.click();

      await expect(submission).not.toBeVisible();
      await expect(contributorCard.getByTestId('bounty-card-status-pill')).toHaveText('Submitted');
      await expect(contributorCard.getByRole('button', { name: /^Submit:/ })).toHaveCount(0);
    });

    await test.step('maintainer releases the submitted bounty', async () => {
      await maintainer.reload();
      await expect(maintainer.locator('.freighter-connected')).toContainText('GAAAAA...AWHF');
      await expect(maintainerCard.getByTestId('bounty-card-status-pill')).toHaveText('Submitted');
      await expect(maintainerCard).toContainText('GBE6AZ...YWSF');
      maintainer.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('prompt');
        expect(dialog.message()).toBe('Transaction hash (64 hex chars, optional)');
        await dialog.accept('');
      });
      await maintainerCard.getByRole('button', { name: /^Release:/ }).click();
      await expect(maintainerCard.getByTestId('bounty-card-status-pill')).toHaveText('Released');
      await expect(maintainerCard.getByRole('button', { name: /^Release:/ })).toHaveCount(0);

      // Both sessions see the persisted final state after a fresh navigation.
      await maintainer.reload();
      await expect(maintainerCard.getByTestId('bounty-card-status-pill')).toHaveText('Released');
      await contributor.reload();
      await expect(contributorCard.getByTestId('bounty-card-status-pill')).toHaveText('Released');
      await expect(contributorCard.getByRole('button')).toHaveCount(0);
    });
  } finally {
    await contributorContext.close();
  }
});
