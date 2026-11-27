import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

test('ISSUE-1411: docker-compose.yml exists and defines valid local dev services', () => {
  assert.ok(existsSync('docker-compose.yml'), 'docker-compose.yml must exist');
  const content = readFileSync('docker-compose.yml', 'utf8');
  assert.ok(content.includes('services:'), 'docker-compose.yml must define services');
  assert.ok(content.includes('backend:'), 'docker-compose.yml must define backend service');
  assert.ok(content.includes('unless-stopped'), 'docker-compose.yml must define restart policy');
});

test('ISSUE-1411: docker-compose.yml is actively wired into .lintstagedrc.json pre-commit hooks', () => {
  assert.ok(existsSync('.lintstagedrc.json'), '.lintstagedrc.json must exist');
  const lintstaged = JSON.parse(readFileSync('.lintstagedrc.json', 'utf8'));
  const keys = Object.keys(lintstaged);
  assert.ok(
    keys.includes('docker-compose.yml') || keys.some((k) => k.includes('yml')),
    '.lintstagedrc.json must enforce docker-compose.yml'
  );
});

test('ISSUE-1411: docker-compose.yml is enforced in package.json validate:configs pipeline', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.scripts['validate:configs'], 'validate:configs must be present in package.json');
  assert.ok(pkg.scripts['lint'].includes('validate:configs'), 'lint must execute validate:configs');
});
