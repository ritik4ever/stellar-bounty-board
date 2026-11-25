import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateEnvExample,
  validateEslintConfig,
  validateNpmrc,
  validatePipelineWiring,
  validateCiWorkflowDoc,
  validateBindingsDriftDoc,
  determineDevopsOutcome,
  validateTestnetNetworkConsistency,
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

test('ISSUE-1426: docs/CI_WORKFLOW.md classifies template vs deliberately chosen non-obvious settings', () => {
  const ciResult = validateCiWorkflowDoc();
  assert.equal(ciResult.valid, true, `CI doc errors: ${ciResult.errors.join('; ')}`);
});

test('ISSUE-1427: .github/workflows/ci.yml is actively wired into pre-commit and CI enforcement', () => {
  const pipeline = validatePipelineWiring();
  assert.equal(pipeline.valid, true, `Pipeline errors: ${pipeline.errors.join('; ')}`);
});

test('ISSUE-1428: docs/BINDINGS_DRIFT_WORKFLOW.md confirms bindings-drift matches actual source usage', () => {
  const bindingsResult = validateBindingsDriftDoc();
  assert.equal(
    bindingsResult.valid,
    true,
    `Bindings drift errors: ${bindingsResult.errors.join('; ')}`
  );
});

test('ISSUE-1429: docs/BINDINGS_DRIFT_WORKFLOW.md classifies non-obvious settings and template values', () => {
  const bindingsResult = validateBindingsDriftDoc();
  assert.equal(
    bindingsResult.valid,
    true,
    `Bindings drift errors: ${bindingsResult.errors.join('; ')}`
  );
});

test('ISSUE-1430: .github/workflows/bindings-drift.yml is actively wired into pre-commit and CI enforcement', () => {
  const pipeline = validatePipelineWiring();
  assert.equal(pipeline.valid, true, `Pipeline errors: ${pipeline.errors.join('; ')}`);
});

test('ISSUE-1431: docs/BINDINGS_DRIFT_WORKFLOW.md documents deliberate deviations from tool defaults', () => {
  const bindingsResult = validateBindingsDriftDoc();
  assert.equal(
    bindingsResult.valid,
    true,
    `Bindings drift errors: ${bindingsResult.errors.join('; ')}`
  );
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

test('SBB-2026-492: mainnet passphrase paired with a testnet contract ID is rejected with clear guidance', () => {
  const result = validateTestnetNetworkConsistency({
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  });
  assert.equal(result.valid, false, 'Mismatched network/passphrase must be rejected');
  assert.ok(result.errors.length > 0, 'A clear error must be reported');
  const combined = result.errors.join(' ').toLowerCase();
  assert.ok(combined.includes('mainnet'), 'Error must name the mainnet passphrase');
  assert.ok(combined.includes('testnet'), 'Error must name the testnet contract ID');
  assert.ok(
    result.recovery && result.recovery.length > 0,
    'A recovery path must be provided'
  );
  assert.ok(
    result.recovery.join(' ').toLowerCase().includes('testnet'),
    'Recovery guidance must point back to a testnet passphrase'
  );
});

test('SBB-2026-492: matching network/passphrase pairs pass the preflight', () => {
  const testnet = validateTestnetNetworkConsistency({
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  });
  assert.equal(testnet.valid, true, `Testnet errors: ${testnet.errors.join('; ')}`);

  const mainnet = validateTestnetNetworkConsistency({
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    contractId: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  });
  assert.equal(mainnet.valid, true, `Mainnet errors: ${mainnet.errors.join('; ')}`);
});

test('SBB-2026-492: repeated preflight invocations fail identically without mutating state (rerun safety)', () => {
  const input = {
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  };
  const snapshot = JSON.stringify(input);

  const first = validateTestnetNetworkConsistency(input);
  const second = validateTestnetNetworkConsistency(input);

  assert.equal(first.valid, false);
  assert.equal(second.valid, false);
  assert.deepEqual(first.errors, second.errors, 'Reruns must report the same errors');
  assert.deepEqual(first.recovery, second.recovery, 'Reruns must report the same recovery');
  assert.equal(JSON.stringify(input), snapshot, 'Preflight must not mutate its input');
});

test('SBB-2026-492: network-consistency preflight is wired into validate:configs before signing', () => {
  const pipeline = validatePipelineWiring();
  assert.equal(pipeline.valid, true, `Pipeline errors: ${pipeline.errors.join('; ')}`);
  assert.ok(
    pipeline.checks && pipeline.checks.networkConsistencyPreflight === true,
    'validate:configs must run the network-consistency preflight'
  );
});
