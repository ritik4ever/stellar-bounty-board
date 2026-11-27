import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('i18n catalogs and context structure', () => {
  const enPath = path.resolve('frontend/src/i18n/locales/en.json');
  const esPath = path.resolve('frontend/src/i18n/locales/es.json');
  const contextPath = path.resolve('frontend/src/i18n/I18nContext.tsx');
  const mainPath = path.resolve('frontend/src/main.tsx');
  const readmePath = path.resolve('frontend/README.md');

  assert.ok(fs.existsSync(enPath), 'en.json exists');
  assert.ok(fs.existsSync(esPath), 'es.json exists');
  assert.ok(fs.existsSync(contextPath), 'I18nContext.tsx exists');
  assert.ok(fs.existsSync(mainPath), 'main.tsx exists');
  assert.ok(fs.existsSync(readmePath), 'frontend/README.md exists');

  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const es = JSON.parse(fs.readFileSync(esPath, 'utf8'));

  assert.ok(en['app.title'], 'en has app.title');
  assert.ok(es['app.title'], 'es has app.title');
  assert.ok(en['common.share'], 'en has common.share');
  assert.ok(es['common.share'], 'es has common.share');

  const contextSrc = fs.readFileSync(contextPath, 'utf8');
  assert.ok(contextSrc.includes('export function I18nProvider'), 'exports I18nProvider');
  assert.ok(contextSrc.includes('export function useI18n'), 'exports useI18n');
  assert.ok(contextSrc.includes('export function LanguageSwitcher'), 'exports LanguageSwitcher');

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainSrc.includes('I18nProvider'), 'main.tsx wraps App with I18nProvider');

  const readmeSrc = fs.readFileSync(readmePath, 'utf8');
  assert.ok(readmeSrc.includes('Adding a New Locale'), 'README documents adding new locales');
});
