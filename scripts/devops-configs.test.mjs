import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateEnvExample,
  validateEslintConfig,
  validateNpmrc,
  validatePipelineWiring,
  validateCiWorkflowDoc,
  determineDevopsOutcome,
} from './validate-devops-configs.mjs';

test('ISSUE-1396 & ISSUE-1397: .env.example contains explanatory comments and has no duplicate keys', () => {
  const envResult = validateEnvExample();
  assert.equal(envResult.valid, true, `Env errors: ${envResult.errors.join('; ')}`);
  assert.ok(envResult.keyCount > 0, '.env.example must have valid keys');
});

test('ISSUE-1399 & ISSUE-1401: .eslintrc.json non-obvious rules are documented and verified', () => {
  const eslintResult = validateEslintConfig();
  assert.equal(eslintResult.valid, true, `ESLint errors: ${eslintResult.errors.join('; ')}`);
  assert.equal(eslintResult.config.rules['@typescript-eslint/no-explicit-any'], 'error');
});

test('ISSUE-1433: .npmrc documents deliberate deviations from npm v7+ defaults', () => {
  const npmrcResult = validateNpmrc();
  assert.equal(npmrcResult.valid, true, `npmrc errors: ${npmrcResult.errors.join('; ')}`);
});

test('ISSUE-1424: docs/CI_WORKFLOW.md documents deliberate deviations from tool defaults', () => {
  const ciResult = validateCiWorkflowDoc();
  assert.equal(ciResult.valid, true, `CI doc errors: ${ciResult.errors.join('; ')}`);
});

test('ISSUE-1397, 1401, 1433: pipeline wiring enforces configuration validation', () => {
  const pipeline = validatePipelineWiring();
  assert.equal(pipeline.valid, true, `Pipeline errors: ${pipeline.errors.join('; ')}`);
});

test('determineDevopsOutcome returns VERIFIED when all DevOps configs are enforced', () => {
  const outcome = determineDevopsOutcome();
  assert.equal(outcome.status, 'VERIFIED');
  assert.equal(outcome.reason, 'DEVOPS_CONFIGS_FULLY_ENFORCED');
});
