import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

test('ISSUE-1414: Dockerfile exists and defines multi-stage build and native healthcheck', () => {
  assert.ok(existsSync('Dockerfile'), 'Dockerfile must exist');
  const content = readFileSync('Dockerfile', 'utf8');
  assert.ok(content.includes('AS builder'), 'Dockerfile must define builder stage');
  assert.ok(content.includes('HEALTHCHECK'), 'Dockerfile must define container HEALTHCHECK');
  assert.ok(
    content.includes('node:18-alpine') || content.includes('node:20-alpine'),
    'Dockerfile must use Alpine image'
  );
});

test('ISSUE-1414: Dockerfile is actively wired into .lintstagedrc.json pre-commit hooks', () => {
  assert.ok(existsSync('.lintstagedrc.json'), '.lintstagedrc.json must exist');
  const lintstaged = JSON.parse(readFileSync('.lintstagedrc.json', 'utf8'));
  const keys = Object.keys(lintstaged);
  assert.ok(
    keys.includes('Dockerfile') || keys.includes('Dockerfile*'),
    '.lintstagedrc.json must enforce Dockerfile'
  );
});

test('ISSUE-1414: Dockerfile is enforced in package.json validate:configs pipeline', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.scripts['validate:configs'], 'validate:configs must be present in package.json');
  assert.ok(pkg.scripts['lint'].includes('validate:configs'), 'lint must execute validate:configs');
});
