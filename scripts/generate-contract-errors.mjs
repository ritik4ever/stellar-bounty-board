import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function parseContractErrors(source) {
  const match = source.match(
    /#\[(?:soroban_sdk::)?contracterror\][\s\S]*?pub enum ContractError \{([\s\S]*?)^\}/m
  );
  if (!match) throw new Error('Missing #[contracterror] ContractError enum');
  const names = new Set();
  const codes = new Set();
  const errors = [];
  for (const line of match[1].replace(/\/\/[^\n]*/g, '').split('\n')) {
    if (!line.trim()) continue;
    const variant = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(\d+)\s*,\s*$/);
    if (!variant) throw new Error('Every error must have an explicit u32 code');
    const [, name, value] = variant;
    const code = Number(value);
    if (!Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)
      throw new Error('Invalid error code');
    if (names.has(name) || codes.has(code)) throw new Error('Duplicate error name or code');
    names.add(name);
    codes.add(code);
    errors.push({ name, code });
  }
  if (!errors.length) throw new Error('Empty error enum');
  return errors.sort((a, b) => a.code - b.code);
}

export function generateBindings(source, bindings) {
  const errors = parseContractErrors(source);
  const enumPattern = /^export enum ContractError \{[\s\S]*?^\}/m;
  const labelPattern =
    /^export const CONTRACT_ERROR_LABELS: Record<ContractError, string> = \{[\s\S]*?^\};/m;
  if (!enumPattern.test(bindings) || !labelPattern.test(bindings))
    throw new Error('Missing generated error sections');
  return bindings
    .replace(
      enumPattern,
      'export enum ContractError {\n' +
        errors.map(({ name, code }) => `  ${name} = ${code},`).join('\n') +
        '\n}'
    )
    .replace(
      labelPattern,
      'export const CONTRACT_ERROR_LABELS: Record<ContractError, string> = {\n' +
        errors.map(({ name }) => `  [ContractError.${name}]: "${name}",`).join('\n') +
        '\n};'
    );
}

if (process.argv[1]?.endsWith('generate-contract-errors.mjs')) {
  const source = readFileSync(new URL('../contracts/src/lib.rs', import.meta.url), 'utf8');
  const path = new URL('../frontend/src/generated/types.ts', import.meta.url);
  const current = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const generated = generateBindings(source, current);
  if (process.argv.includes('--check')) {
    if (generated !== current)
      throw new Error(
        'Contract error bindings drifted; run node scripts/generate-contract-errors.mjs'
      );
    console.log('Contract error bindings match the source enum');
  } else {
    writeFileSync(fileURLToPath(path), generated);
    console.log('Updated contract error bindings');
  }
}
