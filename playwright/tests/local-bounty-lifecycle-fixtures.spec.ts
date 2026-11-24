import { test, expect, type Page } from '@playwright/test';

// Browser exercises the real frontend while all /api calls are intercepted.
// No backend, Freighter signing, Soroban RPC, or funds are used.
const MAINTAINER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const CONTRIBUTOR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const now = 1793505600;

type MockBounty = {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  contributor?: string;
  tokenSymbol: string;
  amount: number;
  labels: Array<{ name: string; color: string }>;
  status: 'open' | 'reserved' | 'submitted' | 'released';
  createdAt: number;
  deadlineAt: number;
  version: number;
  events: Array<{ type: string; timestamp: number }>;
  submissionUrl?: string;
};

function createApiDouble(initial: MockBounty[] = []) {
  const bounties: MockBounty[] = [...initial];
  let releaseCalls = 0;
  const calls: string[] = [];
  let unblockRelease: (() => void) | undefined;
  let releaseGate: Promise<void> | undefined;
  return {
    bounties,
    calls,
    get releaseCalls() { return releaseCalls; },
    delayRelease() { releaseGate = new Promise<void>((resolve) => { unblockRelease = resolve; }); },
    confirmRelease() { unblockRelease?.(); },
    async install(page: Page) {
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        const pathname = url.pathname;
        calls.push(`${method} ${pathname}`);
        const send = (data: unknown, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

        if (method === 'GET' && pathname === '/api/open-issues') return send({ data: [] });
        if (method === 'GET' && pathname === '/api/bounties') {
          return send({ data: bounties, total: bounties.length, page: 1, pageSize: 10, hasMore: false });
        }
        if (method === 'POST' && pathname === '/api/bounties') {
          const payload = request.postDataJSON();
          const record: MockBounty = {
            ...payload,
            id: 'BNT-9599',
            status: 'open',
            createdAt: now,
            deadlineAt: 1893456000,
            version: 1,
            events: [{ type: 'created', timestamp: now }],
            labels: [],
          };
          bounties.push(record);
          return send({ data: record }, 201);
        }
        const match = pathname.match(/^\/api\/bounties\/([^/]+)(?:\/(reserve|submit|release))?$/);
        if (match) {
          const bounty = bounties.find((row) => row.id === match[1]);
          if (!bounty) return send({ error: 'Not found' }, 404);
          if (method === 'GET' && !match[2]) return send({ data: bounty });
          if (method !== 'POST') return send({ error: 'Method not allowed' }, 405);
          const action = match[2];
          const payload = request.postDataJSON();
          if (action === 'reserve' && bounty.status === 'open') {
            bounty.status = 'reserved';
            bounty.contributor = payload.contributor;
          } else if (action === 'submit' && bounty.status === 'reserved') {
            bounty.status = 'submitted';
            bounty.submissionUrl = payload.submissionUrl;
          } else if (action === 'release' && bounty.status === 'submitted') {
            releaseCalls += 1;
            // Simulated *server* confirmation: never invoke a real wallet.
            if (releaseGate) await releaseGate;
            bounty.status = 'released';
          } else {
            return send({ error: 'Invalid lifecycle transition' }, 409);
          }
          bounty.version += 1;
          bounty.events.push({ type: bounty.status, timestamp: now + bounty.events.length * 60 });
          return send({ data: bounty });
        }
        return send({ data: [] });
      });
    },
  };
}

test('create, reserve and submit use deterministic API fixtures', async ({ page }) => {
  const fake = createApiDouble();
  await fake.install(page);
  await page.goto('/');
  await page.getByLabel('Title', { exact: true }).fill('Offline E2E fixture bounty');
  await page.getByRole('button', { name: 'Create Bounty' }).click();
  await expect.poll(() => fake.bounties[0]?.status).toBe('open');
  await expect(page.getByText('Offline E2E fixture bounty').first()).toBeVisible();

  page.once('dialog', async (dialog) => dialog.accept(CONTRIBUTOR));
  await page.getByTestId('action-button-reserve').first().click();
  await expect.poll(() => fake.bounties[0]?.status).toBe('reserved');

  await page.getByTestId('action-button-submit').first().click();
  await page.getByLabel('Pull request or demo URL *').fill('https://github.com/local/seed-fixtures/pull/9599');
  for (const name of ['PR is linked to the correct issue', 'PR description explains the changes', 'All CI checks pass']) {
    await page.getByRole('checkbox', { name }).click();
  }
  await page.getByRole('button', { name: 'Submit work' }).click();
  await expect.poll(() => fake.bounties[0]?.status).toBe('submitted');
  expect(fake.bounties[0].events.map((event) => event.type)).toEqual(['created', 'reserved', 'submitted']);
  expect(fake.calls.filter((call) => call === 'POST /api/bounties/BNT-9599/submit')).toHaveLength(1);
});

test('release without a connected wallet is rejected before API submission', async ({ page }) => {
  const fake = createApiDouble([{
    id: 'BNT-9599', repo: 'local/seed-fixtures', issueNumber: 9599,
    title: 'Wallet reject fixture', summary: 'No live funds', maintainer: MAINTAINER,
    contributor: CONTRIBUTOR, tokenSymbol: 'XLM', amount: 10, labels: [],
    status: 'submitted', createdAt: now, deadlineAt: 1893456000, version: 3,
    events: ['created', 'reserved', 'submitted'].map((type, i) => ({ type, timestamp: now + i * 60 })),
  }]);
  await fake.install(page);
  await page.goto('/');
  await page.getByTestId('action-button-release').first().click();
  await expect(page.getByText(/connect your Freighter wallet first/i)).toBeVisible();
  expect(fake.releaseCalls).toBe(0);
  expect(fake.bounties[0].status).toBe('submitted');
});

test('mock release stays submitted until simulated confirmation arrives', async ({ page }) => {
  const fake = createApiDouble([{
    id: 'BNT-9599', repo: 'local/seed-fixtures', issueNumber: 9599,
    title: 'Delayed release fixture', summary: 'No live funds', maintainer: MAINTAINER,
    contributor: CONTRIBUTOR, tokenSymbol: 'XLM', amount: 10, labels: [],
    status: 'submitted', createdAt: now, deadlineAt: 1893456000, version: 3,
    events: ['created', 'reserved', 'submitted'].map((type, i) => ({ type, timestamp: now + i * 60 })),
  }]);
  fake.delayRelease();
  await fake.install(page);
  await page.goto('/');
  // This is a transport double, not a signed UI release. It intentionally has
  // no signing key; only the mock response changes fixture state.
  await page.evaluate(() => {
    (window as Window & { __fixtureRelease?: Promise<unknown> }).__fixtureRelease =
      fetch('/api/bounties/BNT-9599/release', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulated: true }),
      }).then((response) => response.json());
  });
  await expect.poll(() => fake.releaseCalls).toBe(1);
  expect(fake.bounties[0].status).toBe('submitted');
  fake.confirmRelease();
  await expect.poll(() => fake.bounties[0].status).toBe('released');
  expect(fake.bounties[0].events.map((event) => event.type)).toEqual(['created', 'reserved', 'submitted', 'released']);
});
