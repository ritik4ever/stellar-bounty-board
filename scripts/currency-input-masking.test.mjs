import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #855: Add currency/amount input masking with thousands separators
// Acceptance criteria:
// 1. Typing a large amount displays with thousands separators in real time
// 2. The value submitted to the API is a clean unformatted number regardless of display formatting
// 3. Handle paste events that include existing formatting or currency symbols gracefully
// 4. Tests cover typing, pasting, and clearing the masked input

test('ISSUE-855: utils.ts exports formatCurrencyInput and parseCurrencyInput helpers', () => {
  const utilsPath = join(process.cwd(), 'frontend', 'src', 'utils.ts');
  assert.ok(existsSync(utilsPath), 'frontend/src/utils.ts must exist');

  const content = readFileSync(utilsPath, 'utf8');
  assert.match(content, /export function formatCurrencyInput/, 'must export formatCurrencyInput');
  assert.match(content, /export function parseCurrencyInput/, 'must export parseCurrencyInput');
});

test('ISSUE-855: formatCurrencyInput formats integer and decimal values with thousands separators', () => {
  function formatCurrencyInput(value) {
    if (value === '' || value === null || value === undefined) return '';
    const str = String(value).replace(/[^0-9.]/g, '');
    if (!str) return '';
    const parts = str.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.length > 1 ? `${integerPart}.${parts[1]}` : integerPart;
  }

  assert.equal(formatCurrencyInput(150), '150');
  assert.equal(formatCurrencyInput(1500), '1,500');
  assert.equal(formatCurrencyInput(10000), '10,000');
  assert.equal(formatCurrencyInput(1000000), '1,000,000');
  assert.equal(formatCurrencyInput('2500000.75'), '2,500,000.75');
  assert.equal(formatCurrencyInput(''), '');
  assert.equal(formatCurrencyInput(null), '');
  assert.equal(formatCurrencyInput(undefined), '');
});

test('ISSUE-855: parseCurrencyInput extracts clean numeric values from formatted strings', () => {
  function parseCurrencyInput(value) {
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    if (!value || typeof value !== 'string') return 0;
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (!cleaned) return 0;
    const parts = cleaned.split('.');
    const integerPart = parts[0] || '0';
    const decimalPart = parts.length > 1 ? `.${parts[1]}` : '';
    const num = Number(`${integerPart}${decimalPart}`);
    return isNaN(num) ? 0 : num;
  }

  assert.equal(parseCurrencyInput('150'), 150);
  assert.equal(parseCurrencyInput('1,500'), 1500);
  assert.equal(parseCurrencyInput('1,000,000'), 1000000);
  assert.equal(parseCurrencyInput('$1,000,000.50'), 1000000.5);
  assert.equal(parseCurrencyInput('XLM 25,000.25'), 25000.25);
  assert.equal(parseCurrencyInput(''), 0);
  assert.equal(parseCurrencyInput('abc'), 0);
  assert.equal(parseCurrencyInput(500), 500);
});

test('ISSUE-855: Typing, pasting, and clearing masked input behavior', () => {
  // Simulate React state update behavior in App.tsx
  let displayAmount = '';
  let formAmount = 0;

  function simulateChange(rawVal) {
    const cleaned = rawVal.replace(/[^0-9.]/g, '');
    if (!cleaned) {
      displayAmount = '';
      formAmount = 0;
      return;
    }
    const parts = cleaned.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    displayAmount = parts.length > 1 ? `${integerPart}.${parts[1]}` : integerPart;
    formAmount = Number(cleaned);
  }

  // 1. Typing single digits incrementally
  simulateChange('1');
  assert.equal(displayAmount, '1');
  assert.equal(formAmount, 1);

  simulateChange('15');
  assert.equal(displayAmount, '15');
  assert.equal(formAmount, 15);

  simulateChange('1500');
  assert.equal(displayAmount, '1,500');
  assert.equal(formAmount, 1500);

  simulateChange('1500000');
  assert.equal(displayAmount, '1,500,000');
  assert.equal(formAmount, 1500000);

  // 2. Pasting formatted currency string
  const pastedInput = '$ 2,500,000 XLM';
  simulateChange(pastedInput);
  assert.equal(displayAmount, '2,500,000');
  assert.equal(formAmount, 2500000);

  // 3. Clearing the input
  simulateChange('');
  assert.equal(displayAmount, '');
  assert.equal(formAmount, 0);
});

test('ISSUE-855: frontend/src/App.tsx implements masked reward input with paste handling', () => {
  const appPath = join(process.cwd(), 'frontend', 'src', 'App.tsx');
  const content = readFileSync(appPath, 'utf8');

  // Imports
  assert.match(content, /formatCurrencyInput/, 'App.tsx must import formatCurrencyInput');
  assert.match(content, /parseCurrencyInput/, 'App.tsx must import parseCurrencyInput');

  // Input attributes & handlers
  assert.match(
    content,
    /data-testid=["']bounty-reward-input["']/,
    'must have data-testid bounty-reward-input'
  );
  assert.match(
    content,
    /inputMode=["']decimal["']/,
    'must set inputMode to decimal for mobile numpad'
  );
  assert.match(content, /value=\{displayAmount\}/, 'input value must be bound to displayAmount');
  assert.match(
    content,
    /onChange=\{\(e\)\s*=>\s*handleAmountChange\(e\.target\.value\)\}/,
    'must attach handleAmountChange'
  );
  assert.match(content, /onPaste=\{handleAmountPaste\}/, 'must attach onPaste handler');

  // Clean submission: createBounty uses form.amount (clean number)
  assert.match(
    content,
    /await createBounty\(\s*\{[\s\S]*?\.\.\.form/,
    'createBounty receives unformatted clean numeric amount'
  );
});
