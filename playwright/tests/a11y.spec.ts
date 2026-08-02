import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SEEDED_BOUNTY_ID = 'BNT-1001';
const SEEDED_CONTRIBUTOR = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const EXCEPTIONS: Record<string, string[]> = {};

async function assertNoCriticalOrSeriousViolations(page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const allowed = EXCEPTIONS[url] ?? [];
  const filtered = results.violations.filter((v) => !allowed.includes(v.id));

  const criticalOrSerious = filtered.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  expect(criticalOrSerious).toEqual([]);
}

test.describe('Accessibility audit', () => {
  test('main board page has no critical/serious a11y violations', async ({ page }) => {
    await assertNoCriticalOrSeriousViolations(page, '/');
  });

  test('bounty detail page has no critical/serious a11y violations', async ({ page }) => {
    await assertNoCriticalOrSeriousViolations(page, `/bounties/${SEEDED_BOUNTY_ID}`);
  });

  test('contributor profile page has no critical/serious a11y violations', async ({ page }) => {
    await assertNoCriticalOrSeriousViolations(page, `/contributor/${SEEDED_CONTRIBUTOR}`);
  });

  test('repo filter page has no critical/serious a11y violations', async ({ page }) => {
    await assertNoCriticalOrSeriousViolations(page, '/repo/ritik4ever/stellar-bounty-board');
  });
});
