import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1449: Add GitHub webhook sync for PR merge state
// Acceptance criteria:
// 1. Webhook handler reacts to PR merge events
// 2. Bounty state transitions on merge
// 3. Maintainer still confirms final release (not fully automatic)

test('ISSUE-1449: githubPrHandler.ts handles PR merge and exports syncPrMergeState', () => {
  const handlerPath = join(process.cwd(), 'backend', 'src', 'webhooks', 'githubPrHandler.ts');
  assert.ok(existsSync(handlerPath), 'githubPrHandler.ts must exist');

  const content = readFileSync(handlerPath, 'utf8');
  assert.match(
    content,
    /export async function handleGitHubPrEvent/,
    'must export handleGitHubPrEvent'
  );
  assert.match(
    content,
    /export async function syncPrMergeState/,
    'must export syncPrMergeState helper'
  );
  assert.match(
    content,
    /markBountyPrMerged/,
    'must call markBountyPrMerged to transition bounty state'
  );
});

test('ISSUE-1449: Webhook handler reacts to PR merge events and supports maintainer confirmation mode', () => {
  const handlerPath = join(process.cwd(), 'backend', 'src', 'webhooks', 'githubPrHandler.ts');
  const content = readFileSync(handlerPath, 'utf8');

  // Verify closed + merged check
  assert.match(
    content,
    /action !== ['"]closed['"]\s*\|\|\s*!pull_request\?\.merged/,
    'must filter for closed and merged pull request events'
  );

  // Verify maintainer confirmation check
  assert.match(
    content,
    /WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION/,
    'must check WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION'
  );

  assert.match(
    content,
    /github_webhook_pr_merged_pending_confirmation/,
    'must log pending confirmation when maintainer confirmation mode is active'
  );
});

test('ISSUE-1449: bountyStore exports markBountyPrMerged and records pr_merged events', () => {
  const storePath = join(process.cwd(), 'backend', 'src', 'services', 'bountyStore.ts');
  const content = readFileSync(storePath, 'utf8');

  assert.match(
    content,
    /export async function markBountyPrMerged/,
    'must export markBountyPrMerged'
  );
  assert.match(content, /prMerged:\s*true/, 'must set prMerged flag to true');
  assert.match(content, /type:\s*['"]pr_merged['"]/, 'must record pr_merged event in event log');
  assert.match(
    content,
    /transition:\s*['"]pr_merged['"]/,
    'must append audit log transition for pr_merged'
  );
});

test('ISSUE-1449: Webhook configuration defines requireMaintainerConfirmation', () => {
  const configPath = join(process.cwd(), 'backend', 'src', 'webhooks', 'config.ts');
  const content = readFileSync(configPath, 'utf8');

  assert.match(
    content,
    /requireMaintainerConfirmation:\s*boolean/,
    'WebhookConfig must define requireMaintainerConfirmation'
  );
  assert.match(
    content,
    /WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION/,
    'config must parse WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION env var'
  );
});

test('ISSUE-1449: BountyDetailPage surfaces PR Merged status pill and timestamp', () => {
  const detailPath = join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.tsx');
  const content = readFileSync(detailPath, 'utf8');

  assert.match(
    content,
    /data-testid=['"]bounty-pr-merged-status['"]/,
    'must render bounty-pr-merged-status badge'
  );
  assert.match(content, /bounty\.prMergedAt/, 'must display prMergedAt timestamp in meta-grid');
  assert.match(
    content,
    /pr_merged:\s*['"]Pull request merged['"]/,
    'EVENT_LABELS must include pr_merged label'
  );
});

test('ISSUE-1449: docs/webhook-signatures.md documents PR merge sync and confirmation flow', () => {
  const docPath = join(process.cwd(), 'docs', 'webhook-signatures.md');
  const content = readFileSync(docPath, 'utf8');

  assert.match(
    content,
    /## PR Merge State Sync & Confirmation Flow/,
    'must include PR Merge State Sync & Confirmation Flow section'
  );
  assert.match(content, /Confirmation Mode/, 'must describe maintainer confirmation mode');
  assert.match(
    content,
    /WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION/,
    'must document WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION configuration'
  );
});
