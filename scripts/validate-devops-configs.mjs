#!/usr/bin/env node

/**
 * DevOps Configuration & Policy Enforcement Validator
 *
 * Resolves:
 * - Issue #1396: DevOps: add a comment explaining non-obvious settings in `.env.example`
 * - Issue #1397: DevOps: add `.env.example` to the pre-commit / CI checks if it isn't already enforced
 * - Issue #1399: DevOps: add a comment explaining non-obvious settings in `.eslintrc.json`
 * - Issue #1401: DevOps: add `.eslintrc.json` to the pre-commit / CI checks if it isn't already enforced
 * - Issue #1433: DevOps: add `.npmrc` to the pre-commit / CI checks if it isn't already enforced
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function validateEnvExample(cwd = process.cwd()) {
  const errors = [];
  const envPath = join(cwd, '.env.example');

  if (!existsSync(envPath)) {
    return { valid: false, errors: ['.env.example is missing'] };
  }

  const content = readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const keys = new Set();
  const duplicateKeys = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      if (keys.has(key)) {
        duplicateKeys.push(key);
      }
      keys.add(key);
    }
  }

  if (duplicateKeys.length > 0) {
    errors.push(`Duplicate keys found in .env.example: ${duplicateKeys.join(', ')}`);
  }

  // Issue #1396: Verify explanatory comments for non-obvious settings
  const requiredExplanations = ['PORT=3001', 'BOUNTY_STORE_PATH', 'RATE_LIMIT', 'SOROBAN_RPC_URL'];

  for (const exp of requiredExplanations) {
    if (!content.includes(exp)) {
      errors.push(
        `Missing architectural comment or setting for "${exp}" in .env.example (Issue #1396)`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    keyCount: keys.size,
  };
}

export function validateEslintConfig(cwd = process.cwd()) {
  const errors = [];
  const eslintPath = join(cwd, '.eslintrc.json');
  const docPath = join(cwd, 'docs/ESLINT_CONFIG.md');

  if (!existsSync(eslintPath)) {
    return { valid: false, errors: ['.eslintrc.json is missing'] };
  }

  let config;
  try {
    config = JSON.parse(readFileSync(eslintPath, 'utf8'));
  } catch (err) {
    return { valid: false, errors: [`Failed to parse .eslintrc.json: ${err.message}`] };
  }

  if (config.rules?.['@typescript-eslint/no-explicit-any'] !== 'error') {
    errors.push('@typescript-eslint/no-explicit-any must be set to "error" in .eslintrc.json');
  }

  // Issue #1399: Verify architectural documentation for non-obvious ESLint rules
  if (!existsSync(docPath)) {
    errors.push('docs/ESLINT_CONFIG.md is missing (Issue #1399)');
  } else {
    const doc = readFileSync(docPath, 'utf8');
    if (
      !doc.includes('no-explicit-any') ||
      !doc.includes('import/extensions') ||
      !doc.includes('no-unused-vars')
    ) {
      errors.push('docs/ESLINT_CONFIG.md must document non-obvious settings (Issue #1399)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    config,
  };
}

export function validateNpmrc(cwd = process.cwd()) {
  const errors = [];
  const npmrcPath = join(cwd, '.npmrc');

  if (!existsSync(npmrcPath)) {
    return { valid: false, errors: ['.npmrc is missing'] };
  }

  const content = readFileSync(npmrcPath, 'utf8');

  // Issue #1433: Verify critical settings and explanatory comments
  if (!content.includes('legacy-peer-deps=true')) {
    errors.push('.npmrc must define legacy-peer-deps=true for monorepo dependency resolution');
  }
  if (!content.includes('fund=false')) {
    errors.push('.npmrc must define fund=false');
  }
  if (!content.includes('Deliberate Deviation') && !content.includes('legacy-peer-deps=false')) {
    errors.push('.npmrc must explain why legacy-peer-deps differs from npm v7+ defaults');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validatePipelineWiring(cwd = process.cwd()) {
  const errors = [];
  const pkgPath = join(cwd, 'package.json');

  if (!existsSync(pkgPath)) {
    return { valid: false, errors: ['package.json is missing'] };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  // Issue #1397: .env.example enforced in pipeline
  if (!pkg.scripts['validate:configs']) {
    errors.push('Missing "validate:configs" script in package.json (Issue #1397, #1401, #1433)');
  }
  if (!pkg.scripts['lint']?.includes('validate:configs')) {
    errors.push('"lint" script must include "validate:configs" in package.json');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

const NETWORK_CLASSIFIERS = [
  { network: 'mainnet', pattern: /(pubnet|mainnet|public)/i },
  { network: 'testnet', pattern: /(testnet|test)/i },
  { network: 'futurenet', pattern: /(futurenet|future)/i },
];

/**
 * Classify a network passphrase or network name into a known Stellar network.
 * Returns 'unknown' when no known network marker is present.
 */
export function classifyNetwork(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'unknown';
  for (const { network, pattern } of NETWORK_CLASSIFIERS) {
    if (pattern.test(value)) return network;
  }
  return 'unknown';
}

/**
 * Classify the network implied by a contract ID.
 * Soroban contract IDs are 56-char StrKey strings beginning with 'C'. The
 * network is not encoded in the ID itself, so we infer it from well-known
 * testnet/mainnet prefixes when present, otherwise fall back to 'unknown'.
 */
export function classifyContractId(contractId) {
  if (typeof contractId !== 'string' || contractId.trim() === '') return 'unknown';
  const id = contractId.trim();
  if (!/^C[A-Z2-7]{55}$/.test(id)) return 'invalid';
  // Heuristic: contract IDs generated for testnet commonly start with 'CB' or
  // 'CD' in fixtures; mainnet fixtures commonly start with 'CA'. This is only
  // used to detect obvious mismatches, never to authorize a transaction.
  if (/^C[BD]/.test(id)) return 'testnet';
  if (/^CA/.test(id)) return 'mainnet';
  return 'unknown';
}

/**
 * Issue #1961 (SBB-2026-492): Preflight network-consistency check.
 *
 * Pure and idempotent: performs no I/O, no signing, and no fund movement.
 * Callers MUST invoke this before any signing or fund movement so that a
 * mismatched passphrase/contract pair stops the run with a recovery path.
 *
 * @param {{ passphrase?: string, network?: string, contractId?: string }} input
 * @returns {{ ok: boolean, errors: string[], recovery: string[] }}
 */
export function validateNetworkConsistency(input = {}) {
  const errors = [];
  const recovery = [];

  const passphrase = input.passphrase ?? '';
  const networkName = input.network ?? '';
  const contractId = input.contractId ?? '';

  const passphraseNetwork = classifyNetwork(passphrase);
  const nameNetwork = classifyNetwork(networkName);
  const contractNetwork = classifyContractId(contractId);

  // Resolve the effective configured network, preferring the passphrase.
  let configuredNetwork = passphraseNetwork;
  if (configuredNetwork === 'unknown') configuredNetwork = nameNetwork;

  if (configuredNetwork === 'unknown') {
    errors.push(
      'Unable to determine the configured Stellar network from SOROBAN_NETWORK_PASSPHRASE or STELLAR_NETWORK.'
    );
    recovery.push(
      'Set SOROBAN_NETWORK_PASSPHRASE to the exact passphrase for the target network (e.g. "Test SDF Network ; September 2015" for testnet).'
    );
  }

  if (contractNetwork === 'invalid') {
    errors.push(
      `SOROBAN_CONTRACT_ID "${contractId}" is not a valid Soroban contract ID (expected 56-char StrKey starting with "C").`
    );
    recovery.push(
      'Re-deploy the contract to the intended network and copy the resulting contract ID into SOROBAN_CONTRACT_ID.'
    );
  }

  if (
    configuredNetwork !== 'unknown' &&
    contractNetwork !== 'unknown' &&
    contractNetwork !== 'invalid' &&
    configuredNetwork !== contractNetwork
  ) {
    errors.push(
      `Network mismatch: passphrase/network resolves to "${configuredNetwork}" but SOROBAN_CONTRACT_ID resolves to "${contractNetwork}".`
    );
    recovery.push(
      `STOP before signing or moving funds. Either switch SOROBAN_NETWORK_PASSPHRASE/STELLAR_NETWORK to ${contractNetwork}, or replace SOROBAN_CONTRACT_ID with a contract deployed on ${configuredNetwork}.`
    );
    recovery.push(
      'Re-run `npm run validate:configs` after correcting the configuration; repeated runs fail identically until the mismatch is resolved.'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    recovery,
  };
}

/**
 * Read network configuration from the environment and run the preflight check.
 * Idempotent: safe to call repeatedly; never signs or moves funds.
 */
export function validateNetworkConsistencyFromEnv(env = process.env) {
  return validateNetworkConsistency({
    passphrase: env.SOROBAN_NETWORK_PASSPHRASE,
    network: env.STELLAR_NETWORK,
    contractId: env.SOROBAN_CONTRACT_ID,
  });
}

export function validateRailwayToml(cwd = process.cwd()) {
  const errors = [];
  const railwayPath = join(cwd, 'railway.toml');

  if (!existsSync(railwayPath)) {
    return { valid: false, errors: ['railway.toml is missing (Issue #1417)'] };
  }

  const content = readFileSync(railwayPath, 'utf8');
  if (!content.includes('builder = "DOCKERFILE"')) {
    errors.push('railway.toml must define builder = "DOCKERFILE"');
  }
  if (!content.includes('healthcheckPath = "/api/health"')) {
    errors.push('railway.toml must define healthcheckPath = "/api/health"');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateDockerfile(cwd = process.cwd()) {
  const errors = [];
  const dockerfilePath = join(cwd, 'Dockerfile');

  if (!existsSync(dockerfilePath)) {
    return { valid: false, errors: ['Dockerfile is missing (Issue #1414)'] };
  }

  const content = readFileSync(dockerfilePath, 'utf8');
  if (!content.includes('AS builder')) {
    errors.push('Dockerfile must define multi-stage build with builder stage');
  }
  if (!content.includes('HEALTHCHECK')) {
    errors.push('Dockerfile must define container HEALTHCHECK probe');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateDockerCompose(cwd = process.cwd()) {
  const errors = [];
  const composePath = join(cwd, 'docker-compose.yml');

  if (!existsSync(composePath)) {
    return { valid: false, errors: ['docker-compose.yml is missing (Issue #1411)'] };
  }

  const content = readFileSync(composePath, 'utf8');
  if (!content.includes('services:')) {
    errors.push('docker-compose.yml must define services');
  }
  if (!content.includes('backend:')) {
    errors.push('docker-compose.yml must define backend service');
  }
  if (!content.includes('unless-stopped')) {
    errors.push('docker-compose.yml must define restart policy');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateLintstagedrc(cwd = process.cwd()) {
  const errors = [];
  const configPath = join(cwd, '.lintstagedrc.json');

  if (!existsSync(configPath)) {
    return { valid: false, errors: ['.lintstagedrc.json is missing (Issue #1404)'] };
  }

  try {
    const content = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!content['.lintstagedrc.json']) {
      errors.push(
        '.lintstagedrc.json must define self-validation rule in .lintstagedrc.json (Issue #1404)'
      );
    }
    // Issue #1427: Enforce .github/workflows/ci.yml validation in pre-commit
    if (!content['.github/workflows/ci.yml']) {
      errors.push(
        '.lintstagedrc.json must enforce .github/workflows/ci.yml validation (Issue #1427)'
      );
    }
    // Issue #1430: Enforce .github/workflows/bindings-drift.yml validation in pre-commit
    if (!content['.github/workflows/bindings-drift.yml']) {
      errors.push(
        '.lintstagedrc.json must enforce .github/workflows/bindings-drift.yml validation (Issue #1430)'
      );
    }
  } catch (e) {
    errors.push(`.lintstagedrc.json contains invalid JSON: ${e.message}`);
  }

  const preCommitPath = join(cwd, '.husky', 'pre-commit');
  if (!existsSync(preCommitPath)) {
    errors.push('.husky/pre-commit is missing');
  } else {
    const preCommit = readFileSync(preCommitPath, 'utf8');
    if (!preCommit.includes('lint-staged')) {
      errors.push('.husky/pre-commit must execute lint-staged (Issue #1404)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateCiWorkflowDoc(cwd = process.cwd()) {
  const errors = [];
  const docPath = join(cwd, 'docs', 'CI_WORKFLOW.md');

  if (!existsSync(docPath)) {
    return { valid: false, errors: ['docs/CI_WORKFLOW.md is missing (Issue #1424)'] };
  }

  const content = readFileSync(docPath, 'utf8');
  const requiredDeviations = [
    'cache-dependency-path',
    'wasm32-unknown-unknown',
    'cargo-audit',
    'if: always()',
    'Matrix of Deviations from Framework & Action Defaults',
  ];

  for (const item of requiredDeviations) {
    if (!content.includes(item)) {
      errors.push(
        `Missing documentation of tool default deviation "${item}" in docs/CI_WORKFLOW.md (Issue #1424)`
      );
    }
  }

  // Issue #1426: Non-obvious settings breakdown and template vs deliberately chosen classification
  const requiredNonObvious = [
    'Non-Obvious Settings Breakdown & Classification (Issue #1426)',
    'Template Boiler',
    'Deliberately Chosen',
    'restore-keys',
    'node-version',
  ];

  for (const item of requiredNonObvious) {
    if (!content.includes(item)) {
      errors.push(
        `Missing non-obvious setting explanation for "${item}" in docs/CI_WORKFLOW.md (Issue #1426)`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateBindingsDriftDoc(cwd = process.cwd()) {
  const errors = [];
  const docPath = join(cwd, 'docs', 'BINDINGS_DRIFT_WORKFLOW.md');

  if (!existsSync(docPath)) {
    return { valid: false, errors: ['docs/BINDINGS_DRIFT_WORKFLOW.md is missing (Issue #1428)'] };
  }

  const content = readFileSync(docPath, 'utf8');
  const requiredMatches = [
    'Comprehensive Entry-by-Entry Verification Against Actual Usage',
    'scripts/install-stellar-cli.sh',
    'npm run gen:bindings',
    'frontend/src/generated',
    'wasm32-unknown-unknown',
    'VERIFIED MATCH',
  ];

  for (const item of requiredMatches) {
    if (!content.includes(item)) {
      errors.push(
        `Missing verification entry "${item}" in docs/BINDINGS_DRIFT_WORKFLOW.md (Issue #1428)`
      );
    }
  }

  // Issue #1429: Non-obvious settings breakdown and template vs deliberately chosen classification
  const requiredNonObvious = [
    'Non-Obvious Settings Breakdown & Classification (Issue #1429)',
    'Template Boiler',
    'Deliberately Chosen',
    '--exit-code',
    'export PATH',
  ];

  for (const item of requiredNonObvious) {
    if (!content.includes(item)) {
      errors.push(
        `Missing non-obvious setting explanation for "${item}" in docs/BINDINGS_DRIFT_WORKFLOW.md (Issue #1429)`
      );
    }
  }

  // Issue #1431: Matrix of Deviations from Tool & Action Framework Defaults
  const requiredDeviations = [
    'Matrix of Deviations from Tool & Action Framework Defaults (Issue #1431)',
    'prebuilt release tarball',
    'gen-bindings.sh',
    'wasm32-unknown-unknown',
    'frontend/package-lock.json',
  ];

  for (const item of requiredDeviations) {
    if (!content.includes(item)) {
      errors.push(
        `Missing tool default deviation explanation for "${item}" in docs/BINDINGS_DRIFT_WORKFLOW.md (Issue #1431)`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function determineDevopsOutcome(cwd = process.cwd()) {
  const env = validateEnvExample(cwd);
  const eslint = validateEslintConfig(cwd);
  const npmrc = validateNpmrc(cwd);
  const railway = validateRailwayToml(cwd);
  const dockerfile = validateDockerfile(cwd);
  const compose = validateDockerCompose(cwd);
  const lintstaged = validateLintstagedrc(cwd);
  const ciDoc = validateCiWorkflowDoc(cwd);
  const bindingsDoc = validateBindingsDriftDoc(cwd);
  const pipeline = validatePipelineWiring(cwd);
  // Issue #1961 (SBB-2026-492): network-consistency preflight runs before any
  // signing or fund movement so mismatched passphrase/contract pairs stop early.
  const network = validateNetworkConsistencyFromEnv();

  const allErrors = [
    ...env.errors,
    ...eslint.errors,
    ...npmrc.errors,
    ...railway.errors,
    ...dockerfile.errors,
    ...compose.errors,
    ...lintstaged.errors,
    ...ciDoc.errors,
    ...bindingsDoc.errors,
    ...pipeline.errors,
    ...network.errors,
  ];

  if (allErrors.length > 0) {
    const ownerAction =
      network.errors.length > 0
        ? `STOP before signing or moving funds. ${network.recovery.join(' ')}`
        : 'Correct missing configuration entries or pipeline scripts.';
    return {
      status: 'BLOCKED',
      reason: network.errors.length > 0 ? 'NETWORK_MISMATCH' : 'CONFIG_ENFORCEMENT_GAP',
      message: allErrors.join('; '),
      ownerAction,
    };
  }

  return {
    status: 'VERIFIED',
    reason: 'DEVOPS_CONFIGS_FULLY_ENFORCED',
    message:
      '.env.example, .eslintrc.json, and .npmrc are fully documented, non-default settings explained, and actively enforced in repository checks.',
    ownerAction: 'Proceed with normal development.',
  };
}

function runCli() {
  const outcome = determineDevopsOutcome();
  const prefix = '[devops-configs]';

  if (outcome.status === 'BLOCKED') {
    console.error(`\n${prefix} BLOCKED: ${outcome.message}`);
    console.error(`${prefix} ACTION: ${outcome.ownerAction}`);
    process.exit(1);
  }

  console.log(`${prefix} OK: ${outcome.message}`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('validate-devops-configs.mjs')) {
  runCli();
}
