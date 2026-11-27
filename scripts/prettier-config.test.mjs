import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validatePrettierConfig,
  validatePrettierIgnore,
  validatePrettierDocumentation,
  validatePipelineEnforcement,
  determineEnforcementOutcome,
} from './validate-prettier-enforcement.mjs';

test('ISSUE-1436 & ISSUE-1443: Prettier config and ignore are wired into pipeline enforcement', () => {
  const pipeline = validatePipelineEnforcement();
  assert.equal(pipeline.valid, true, `Pipeline errors: ${pipeline.errors.join('; ')}`);
});

test('ISSUE-1439: .prettierrc.json settings and deliberate deviations are documented', () => {
  const config = validatePrettierConfig();
  assert.equal(config.valid, true, `Config errors: ${config.errors.join('; ')}`);
  assert.equal(config.config.printWidth, 100);
  assert.equal(config.config.trailingComma, 'es5');
  assert.equal(config.config.singleQuote, true);
  assert.equal(config.config.endOfLine, 'lf');

  const docs = validatePrettierDocumentation();
  assert.equal(docs.valid, true, `Docs errors: ${docs.errors.join('; ')}`);
});

test('ISSUE-1440: .prettierignore deviations from tool defaults are documented with reasons', () => {
  const ignore = validatePrettierIgnore();
  assert.equal(ignore.valid, true, `Ignore errors: ${ignore.errors.join('; ')}`);
  assert.ok(ignore.content.includes('frontend/src/generated'));
  assert.ok(ignore.content.includes('contracts/test_snapshots'));
  assert.ok(ignore.content.includes('contracts/target'));
});

test('determineEnforcementOutcome verifies complete Prettier compliance across repository', () => {
  const outcome = determineEnforcementOutcome();
  assert.equal(outcome.status, 'VERIFIED');
  assert.equal(outcome.reason, 'PRETTIER_FULLY_ENFORCED');
  assert.ok(outcome.message.includes('.prettierrc.json'));
});
