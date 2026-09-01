import { vi } from 'vitest';

/**
 * Mock the GitHub PR validation module to avoid real GitHub API calls during tests.
 * This allows tests to submit with fake PR URLs without network access.
 */
vi.mock('./src/validation/prUrl', async () => {
  const actual = await vi.importActual<typeof import('./src/validation/prUrl')>('./src/validation/prUrl');
  
  return {
    ...actual,
    validateGithubPrUrlForRepo: async (url: string, repo: string, issueNumber?: number) => {
      // Always validate format
      actual.githubPrUrlSchema.parse(url);
      
      // Also validate that the PR URL matches the repo
      const prRepo = actual.extractGithubPrRepo(url);
      if (prRepo !== repo) {
        throw new Error(`Submission URL repository must match bounty repo ${repo}.`);
      }
      
      // In tests, skip GitHub API verification (no real network calls)
    },
  };
});


