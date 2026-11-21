import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateLintstagedrc } from './validate-devops-configs.mjs';

test('ISSUE-1404: .lintstagedrc.json exists and defines valid lint-staged rules', () => {
  const configPath = join(process.cwd(), '.lintstagedrc.json');
  assert.ok(existsSync(configPath), '.lintstagedrc.json must exist');

  const content = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.ok(content['.lintstagedrc.json'], '.lintstagedrc.json must have self-enforcement rule');
});

test('ISSUE-1404: .lintstagedrc.json is actively wired into .husky/pre-commit', () => {
  const preCommitPath = join(process.cwd(), '.husky', 'pre-commit');
  assert.ok(existsSync(preCommitPath), '.husky/pre-commit must exist');

  const preCommit = readFileSync(preCommitPath, 'utf8');
  assert.match(preCommit, /lint-staged/, '.husky/pre-commit must run lint-staged');
});

test('ISSUE-1404: .lintstagedrc.json is wired into package.json format:check and validator', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  assert.match(
    pkg.scripts['format:check'],
    /\.lintstagedrc\.json/,
    'format:check must include .lintstagedrc.json'
  );

  const result = validateLintstagedrc(process.cwd());
  assert.equal(result.valid, true, `validateLintstagedrc failed: ${result.errors.join(', ')}`);
});
