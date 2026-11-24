/**
 * Isolated webhook payload fixtures for GitHub PR event tests.
 *
 * Each fixture represents a complete, self-contained scenario used by
 * focused tests in `githubPrWebhookScenarios.test.ts`. Fixtures are plain
 * objects so they can be serialised to JSON and re-used across test runs
 * without network access or live funds.
 *
 * Naming convention:
 *   PR_<pull_number>_<scenario_tag>
 *
 * @module test/fixtures/webhookPayloads
 */

/** A valid GitHub merged-PR event payload (the common case). */
export const PR_100_MERGED = {
  action: 'closed' as const,
  pull_request: {
    html_url: 'https://github.com/owner/repo-name/pull/100',
    merged: true,
    number: 100,
    title: 'Implement dashboard feature',
  },
  repository: {
    full_name: 'owner/repo-name',
  },
};

/**
 * The same merged PR delivered again under a second `X-GitHub-Delivery` ID.
 * Used to verify that two distinct delivery IDs for the same merged PR do not
 * produce duplicate `pr_merged` or `released` bounty events.
 */
export const PR_100_MERGED_SECOND_DELIVERY = {
  ...PR_100_MERGED,
};

/**
 * A closed-but-not-merged PR event for the same pull request.
 * The `merged` flag is `false`, so the route must ignore it without changing
 * bounty state.
 */
export const PR_100_CLOSED_NOT_MERGED = {
  action: 'closed' as const,
  pull_request: {
    html_url: 'https://github.com/owner/repo-name/pull/100',
    merged: false,
    number: 100,
    title: 'Implement dashboard feature',
  },
  repository: {
    full_name: 'owner/repo-name',
  },
};

/**
 * An out-of-order close event: the PR was merged before the bounty submission
 * referencing it was recorded.  Used to verify that the delivery is deferred
 * (not marked processed) and later applied on replay.
 */
export const PR_200_OUT_OF_ORDER_CLOSE = {
  action: 'closed' as const,
  pull_request: {
    html_url: 'https://github.com/owner/repo-name/pull/200',
    merged: true,
    number: 200,
    title: 'Fix out-of-order scenario',
  },
  repository: {
    full_name: 'owner/repo-name',
  },
};

/**
 * An opened PR event (non-actionable).  Exercising that the route handles
 * non-close events gracefully without touching bounty state.
 */
export const PR_300_OPENED = {
  action: 'opened' as const,
  pull_request: {
    html_url: 'https://github.com/owner/repo-name/pull/300',
    merged: false,
    number: 300,
    title: 'Work in progress',
  },
  repository: {
    full_name: 'owner/repo-name',
  },
};

/**
 * A merged-PR event carrying a payload that has been tampered with after
 * signing.  The raw bytes sent to the endpoint will differ from the bytes
 * over which the HMAC was computed, producing a signature mismatch (401).
 *
 * Tests must compute an HMAC over the _original_ JSON and then send a _modified_
 * body, or simply supply `'sha256=' + '0'.repeat(64)` as the signature.
 */
export const PR_400_TAMPERED_PAYLOAD = {
  action: 'closed' as const,
  pull_request: {
    html_url: 'https://github.com/owner/repo-name/pull/400',
    merged: true,
    number: 400,
    title: 'Legitimate PR',
    // This extra field simulates an attacker injecting content after signing.
    __injected: true,
  },
  repository: {
    full_name: 'owner/repo-name',
  },
};
