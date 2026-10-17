import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

test('ISSUE-1417: railway.toml exists and defines valid deployment settings', () => {
  assert.ok(existsSync('railway.toml'), 'railway.toml must exist');
  const content = readFileSync('railway.toml', 'utf8');
  assert.ok(content.includes('builder = "DOCKERFILE"'), 'builder must be DOCKERFILE');
  assert.ok(content.includes('dockerfilePath = "Dockerfile"'), 'dockerfilePath must be Dockerfile');
  assert.ok(
    content.includes('healthcheckPath = "/api/health"'),
    'healthcheckPath must be /api/health'
  );
  assert.ok(
    content.includes('restartPolicyType = "ON_FAILURE"'),
    'restartPolicyType must be ON_FAILURE'
  );
});

test('ISSUE-1417: railway.toml is actively wired into .lintstagedrc.json pre-commit hooks', () => {
  assert.ok(existsSync('.lintstagedrc.json'), '.lintstagedrc.json must exist');
  const lintstaged = JSON.parse(readFileSync('.lintstagedrc.json', 'utf8'));
  const keys = Object.keys(lintstaged);
  assert.ok(
    keys.includes('railway.toml') || keys.includes('*.toml'),
    '.lintstagedrc.json must enforce railway.toml'
  );
});

test('ISSUE-1417: railway.toml is enforced in package.json validate:configs pipeline', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.scripts['validate:configs'], 'validate:configs must be present in package.json');
  assert.ok(pkg.scripts['lint'].includes('validate:configs'), 'lint must execute validate:configs');
});
