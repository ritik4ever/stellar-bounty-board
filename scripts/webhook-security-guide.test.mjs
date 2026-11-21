import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('ISSUE-1394: WEBHOOK_SECURITY_GUIDE.md exists and contains verified status and metadata', () => {
  const guidePath = join(process.cwd(), 'WEBHOOK_SECURITY_GUIDE.md');
  assert.ok(existsSync(guidePath), 'WEBHOOK_SECURITY_GUIDE.md must exist');

  const content = readFileSync(guidePath, 'utf8');
  assert.match(content, /Last Verified Date:/, 'Guide must include Last Verified Date');
  assert.match(content, /Issue #1394/, 'Guide must reference Issue #1394');
  assert.match(
    content,
    /backend\/src\/webhooks\/signatureVerification\.ts/,
    'Guide must reference signatureVerification.ts'
  );
  assert.match(
    content,
    /backend\/src\/validation\/webhookSecretValidation\.ts/,
    'Guide must reference webhookSecretValidation.ts'
  );
});

test('ISSUE-1394: all webhook implementation modules and test suites referenced in the guide exist', () => {
  const referencedFiles = [
    'backend/src/webhooks/signatureVerification.ts',
    'backend/src/validation/webhookSecretValidation.ts',
    'backend/src/webhooks/deliveryDedup.ts',
    'backend/src/webhooks/githubPrHandler.ts',
    'backend/test/webhookSecretValidation.test.ts',
    'backend/test/webhookSignature.test.ts',
    'backend/test/webhooks.comprehensive.test.ts',
  ];

  for (const relPath of referencedFiles) {
    const fullPath = join(process.cwd(), relPath);
    assert.ok(existsSync(fullPath), `Referenced file must exist: ${relPath}`);
  }
});
