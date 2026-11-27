import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContractErrors, generateBindings } from './generate-contract-errors.mjs';

const source = readFileSync(new URL('../contracts/src/lib.rs', import.meta.url), 'utf8');
const bindings = readFileSync(
  new URL('../frontend/src/generated/types.ts', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n');
const declaration = (body) => `#[contracterror]\npub enum ContractError {\n${body}\n}`;

test('contract errors and frontend labels have no generated drift', () => {
  assert.equal(generateBindings(source, bindings), bindings);
  const errors = new Map(parseContractErrors(source).map(({ name, code }) => [name, code]));
  for (const [name, code] of [
    ['BountyNotOpen', 1],
    ['BountyNotFound', 2],
    ['BountyAlreadyReserved', 3],
    ['EscrowTransferFailed', 42],
    ['PayoutTransferFailed', 43],
    ['FeeTransferFailed', 44],
    ['RefundTransferFailed', 45],
  ]) {
    assert.equal(errors.get(name), code);
  }
  assert.equal(errors.size, 45);
});

test('generator refuses implicit codes and duplicate wire allocations', () => {
  assert.throws(() => parseContractErrors(declaration('    Implicit,')), /explicit/);
  assert.throws(
    () => parseContractErrors(declaration('    First = 1,\n    Second = 1,')),
    /Duplicate/
  );
  assert.throws(
    () => parseContractErrors(declaration('    First = 1,\n    First = 2,')),
    /Duplicate/
  );
  for (const invalid of [0, 4294967296]) {
    assert.throws(() => parseContractErrors(declaration(`    Invalid = ${invalid},`)), /Invalid/);
  }
});

test('generator requires a contract error enum and both binding sections', () => {
  assert.throws(() => parseContractErrors('enum ContractError {}'), /Missing/);
  assert.throws(() => generateBindings(source, 'export const unrelated = true;'), /Missing/);
});

test('generator keeps unrelated ABI types and is idempotent', () => {
  const next = generateBindings(source, bindings);
  assert.equal(generateBindings(source, next), next);
  assert.equal(
    next.slice(next.indexOf('export interface Bounty')),
    bindings.slice(bindings.indexOf('export interface Bounty'))
  );
});
