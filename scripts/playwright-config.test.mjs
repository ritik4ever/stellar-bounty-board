import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

test('ISSUE-1420: playwright.config.ts exists and defines expected E2E settings', () => {
  assert.ok(existsSync('playwright.config.ts'), 'playwright.config.ts must exist');
  const content = readFileSync('playwright.config.ts', 'utf8');
  assert.ok(content.includes("testDir: 'playwright/tests'"), 'testDir must be configured');
  assert.ok(content.includes('timeout: 60_000'), 'timeout must be configured');
  assert.ok(content.includes('fullyParallel: false'), 'fullyParallel must be false');
});

test('ISSUE-1420: playwright.config.ts is actively wired into .lintstagedrc.json pre-commit hooks', () => {
  assert.ok(existsSync('.lintstagedrc.json'), '.lintstagedrc.json must exist');
  const lintstaged = JSON.parse(readFileSync('.lintstagedrc.json', 'utf8'));
  const keys = Object.keys(lintstaged);
  assert.ok(
    keys.includes('playwright.config.ts'),
    '.lintstagedrc.json must contain a rule for playwright.config.ts'
  );
});

test('ISSUE-1420: playwright.config.ts is wired into package.json format checks', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(
    pkg.scripts['format:check'].includes('playwright.config.ts'),
    'format:check script must include playwright.config.ts'
  );
});
