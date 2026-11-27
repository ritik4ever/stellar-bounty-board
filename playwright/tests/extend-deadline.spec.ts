import { test, expect, Page } from '@playwright/test';

const MAINTAINER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// A validly-formatted Stellar address that is deliberately NOT the bounty's maintainer.
const OTHER_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

function toDatetimeLocal(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function createTestBounty(page: Page, issueNumber: number, title: string) {
  await page.goto('/');

  await page.getByLabel('Repository').fill('ritik4ever/stellar-bounty-board');
  await page.getByLabel('Issue number').fill(String(issueNumber));
  await page.getByLabel('Reward').fill('5');
  await page.getByLabel('Issue title').fill(title);
  await page.getByLabel('Summary').fill('E2E test summary for the extend-deadline flow.');
  await page.getByLabel('Maintainer address').fill(MAINTAINER);
  await page.getByLabel('Token').fill('XLM');
  await page.getByLabel('Deadline in days').fill('7');
  await page.getByLabel('Labels').fill('help wanted');

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/bounties') && r.request().method() === 'POST' && r.status() === 201,
    ),
    page.getByRole('button', { name: 'Publish bounty' }).click(),
  ]);

  const body = await response.json();
  return body.data as { id: string; deadlineAt: number };
}

test.describe('Extend deadline flow (#893)', () => {
  test('maintainer can extend the deadline and the UI reflects the new value', async ({ page, request }) => {
    const bounty = await createTestBounty(page, 89310, 'E2E: extend deadline as maintainer');

    await page.goto(`/bounties/${bounty.id}`);
    await expect(page.getByRole('heading', { name: 'E2E: extend deadline as maintainer' })).toBeVisible();

    const newDeadlineMs = (bounty.deadlineAt + 7 * 24 * 60 * 60) * 1000;
    await page.locator('#extend-deadline-input').fill(toDatetimeLocal(newDeadlineMs));

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/bounties/${bounty.id}/extend-deadline`) && r.status() === 200,
      ),
      page.getByRole('button', { name: 'Extend Deadline' }).click(),
    ]);

    await expect(page.getByRole('status')).toContainText(/Deadline extended/i);

    // Confirm the new deadline was actually persisted server-side.
    const getRes = await request.get(`${API_URL}/api/bounties/${bounty.id}`);
    expect(getRes.ok()).toBeTruthy();
    const updated = (await getRes.json()).data as { deadlineAt: number };
    expect(updated.deadlineAt).toBeGreaterThan(bounty.deadlineAt);

    // Reload and confirm the detail page now displays the updated deadline.
    await page.reload();
    const expectedDeadlineText = new Date(updated.deadlineAt * 1000).toLocaleString();
    await expect(page.getByText(expectedDeadlineText)).toBeVisible();
  });

  test('extending the deadline fails when the maintainer address does not match the bounty', async ({
    page,
    request,
  }) => {
    const bounty = await createTestBounty(page, 89320, 'E2E: extend deadline rejects wrong maintainer');

    const attemptedDeadline = bounty.deadlineAt + 7 * 24 * 60 * 60;
    const res = await request.post(`${API_URL}/api/bounties/${bounty.id}/extend-deadline`, {
      headers: { 'Content-Type': 'application/json' },
      data: { maintainer: OTHER_ADDRESS, newDeadline: attemptedDeadline },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/maintainer/i);

    // The deadline must be unchanged — the action only succeeds for the bounty's real maintainer.
    const getRes = await request.get(`${API_URL}/api/bounties/${bounty.id}`);
    const current = (await getRes.json()).data as { deadlineAt: number };
    expect(current.deadlineAt).toBe(bounty.deadlineAt);
  });
});
