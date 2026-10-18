import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1453: Add a dispute UI for maintainers and arbiters
// Acceptance criteria:
// 1. Maintainer can raise a dispute from the UI within the window
// 2. Arbiter sees a resolution view scoped to disputed bounties
// 3. Both call the contract / API, not just update local state

test('ISSUE-1453: DisputePanel component exists and exports default function', () => {
  const componentPath = join(process.cwd(), 'frontend', 'src', 'DisputePanel.tsx');
  assert.ok(existsSync(componentPath), 'DisputePanel.tsx must exist');

  const content = readFileSync(componentPath, 'utf8');
  assert.match(
    content,
    /export default function DisputePanel/,
    'must export default DisputePanel component'
  );
  assert.match(
    content,
    /import.*disputeBounty.*resolveDisputeBounty.*from ['"]\.\/api['"]/,
    'must import disputeBounty and resolveDisputeBounty from api'
  );
});

test('ISSUE-1453: Maintainer can raise a dispute within the review window', () => {
  const componentPath = join(process.cwd(), 'frontend', 'src', 'DisputePanel.tsx');
  const content = readFileSync(componentPath, 'utf8');

  // Verify review window calculation
  assert.match(
    content,
    /isWithinWindow\s*=\s*bounty\.deadlineAt\s*\?\s*nowSeconds\s*<=\s*bounty\.deadlineAt/i,
    'must calculate isWithinWindow based on deadline'
  );

  // Verify submitted status view
  assert.match(
    content,
    /bounty\.status\s*===\s*['"]submitted['"]/,
    'must render dispute raising options for submitted status'
  );
  assert.match(
    content,
    /data-testid=['"]raise-dispute-btn['"]/,
    'must provide raise dispute button trigger'
  );
  assert.match(
    content,
    /data-testid=['"]dispute-reason-input['"]/,
    'must provide reason input textarea'
  );
  assert.match(
    content,
    /data-testid=['"]submit-dispute-btn['"]/,
    'must provide submit dispute button'
  );
  assert.match(
    content,
    /await disputeBounty\(/,
    'must call disputeBounty API to register dispute on backend/contract'
  );
});

test('ISSUE-1453: Arbiter sees resolution view scoped to disputed bounties', () => {
  const componentPath = join(process.cwd(), 'frontend', 'src', 'DisputePanel.tsx');
  const content = readFileSync(componentPath, 'utf8');

  // Verify disputed status view
  assert.match(
    content,
    /bounty\.status\s*===\s*['"]disputed['"]/,
    'must render arbiter resolution view for disputed status'
  );
  assert.match(
    content,
    /data-testid=['"]arbiter-resolution-view['"]/,
    'must provide scoped arbiter-resolution-view container'
  );
  assert.match(
    content,
    /data-testid=['"]arbiter-address-input['"]/,
    'must provide arbiter public key input'
  );
  assert.match(
    content,
    /data-testid=['"]resolve-release-btn['"]/,
    'must provide release to contributor button'
  );
  assert.match(
    content,
    /data-testid=['"]resolve-refund-btn['"]/,
    'must provide refund to maintainer button'
  );
  assert.match(
    content,
    /await resolveDisputeBounty\(/,
    'must call resolveDisputeBounty API with arbiter decision'
  );
});

test('ISSUE-1453: BountyDetailPage integrates DisputePanel and passes update handlers', () => {
  const detailPath = join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.tsx');
  const content = readFileSync(detailPath, 'utf8');

  assert.match(
    content,
    /import DisputePanel from ['"]\.\/DisputePanel['"]/,
    'BountyDetailPage must import DisputePanel'
  );
  assert.match(
    content,
    /<DisputePanel[\s\S]*bounty=\{bounty\}[\s\S]*\/>/,
    'BountyDetailPage must render DisputePanel component'
  );
});

test('ISSUE-1453: README.md documents Dispute UI Surface under Arbitration Flow', () => {
  const readmePath = join(process.cwd(), 'README.md');
  const content = readFileSync(readmePath, 'utf8');

  assert.match(
    content,
    /### Dispute UI Surface/,
    'README.md must include Dispute UI Surface section'
  );
  assert.match(
    content,
    /Maintainer Review & Dispute Action/,
    'README.md must describe Maintainer dispute actions'
  );
  assert.match(
    content,
    /Arbiter Resolution Panel/,
    'README.md must describe Arbiter resolution panel'
  );
  assert.match(
    content,
    /resolveDisputeBounty/,
    'README.md must document backend/contract resolution calls'
  );
});

test('ISSUE-1453: index.css includes dedicated styles for DisputePanel', () => {
  const cssPath = join(process.cwd(), 'frontend', 'src', 'index.css');
  const content = readFileSync(cssPath, 'utf8');

  assert.match(content, /\.dispute-panel/, 'index.css must style .dispute-panel');
  assert.match(content, /\.dispute-panel__alert/, 'index.css must style .dispute-panel__alert');
  assert.match(
    content,
    /\.dispute-panel__resolution-buttons/,
    'index.css must style .dispute-panel__resolution-buttons'
  );
});
