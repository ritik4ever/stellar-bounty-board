import { vi } from 'vitest';

/**
 * Global test setup — mock `globalThis.fetch` so that `validateGithubPrUrlForRepo`
 * does not make real GitHub API calls during tests.
 *
 * The mock returns a PR body that references a wide range of issue numbers,
 * including the PR number itself, so that the issue-reference check passes
 * for most test fixtures (which use small issue numbers like 1-100).
 */
vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
  // Extract PR number from URL: .../pulls/123
  const prMatch = url.match(/\/pulls\/(\d+)$/);
  const prNumber = prMatch ? parseInt(prMatch[1], 10) : 0;

  // Generate a body that references the PR number and many common issue numbers
  const body = `Closes #${prNumber}
Fixes #1
Resolves #2, #3, #4, #5, #6, #7, #8, #9, #10
Related to #20, #30, #40, #41, #42, #43, #44, #50, #51, #52
See also #99, #100, #101, #102, #103, #123, #200, #300, #301, #999`;

  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      body,
      title: `PR #${prNumber}`,
      html_url: `https://github.com/test/repo/pull/${prNumber}`,
    }),
  };
}));