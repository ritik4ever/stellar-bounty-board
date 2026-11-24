'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PASSPHRASES, STATUSES, isPublicKey, validateConfig, fixtureRecords, mergeFixtures, seedFile } = require('./local-seed-fixtures.cjs');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function fixturePublicKey(tag) {
  const payload = Buffer.concat([Buffer.from([48]), crypto.createHash('sha256').update(`no-private-key:${tag}`).digest()]);
  let crc = 0;
  for (const byte of payload) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 65535 : (crc << 1) & 65535;
  }
  const bytes = Buffer.concat([payload, Buffer.from([crc & 255, crc >> 8])]);
  let out = '', pending = 0, bits = 0;
  for (const byte of bytes) {
    pending = (pending << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(pending >>> bits) & 31];
    }
    pending &= (1 << bits) - 1;
  }
  if (bits) out += ALPHABET[pending << (5 - bits)];
  return out;
}
const identities = {
  maintainer: fixturePublicKey('maintainer'),
  contributor: fixturePublicKey('contributor'),
  arbiter: fixturePublicKey('arbiter'),
};
function env(overrides = {}) {
  return {
    LOCAL_SEED_NETWORK: 'testnet',
    LOCAL_SEED_PASSPHRASE: PASSPHRASES.testnet,
    LOCAL_SEED_MAINTAINER: identities.maintainer,
    LOCAL_SEED_CONTRIBUTOR: identities.contributor,
    LOCAL_SEED_ARBITER: identities.arbiter,
    ...overrides,
  };
}
function inTemp(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbb-local-seed-'));
  try { return callback(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('fixture public keys have valid Stellar checksums and distinct roles', () => {
  Object.values(identities).forEach((key) => assert.equal(isPublicKey(key), true));
  assert.equal(isPublicKey(identities.maintainer.slice(0, -1) + 'A'), false);
});

test('a clean environment fails before creating a store', () => inTemp((root) => {
  assert.throws(() => validateConfig({}, root), /LOCAL_SEED_NETWORK/);
  assert.equal(fs.existsSync(path.join(root, '.tmp')), false);
}));

test('mainnet and a mismatched passphrase fail closed', () => inTemp((root) => {
  assert.throws(() => validateConfig(env({ LOCAL_SEED_NETWORK: 'mainnet' }), root), /never mainnet/);
  assert.throws(() => validateConfig(env({ LOCAL_SEED_PASSPHRASE: 'Public Global Stellar Network ; September 2015' }), root), /does not match/);
  assert.throws(() => validateConfig(env({ NODE_ENV: 'production' }), root), /disabled/);
}));

test('bad or duplicated identity inputs fail before writing JSON', () => inTemp((root) => {
  assert.throws(() => validateConfig(env({ LOCAL_SEED_ARBITER: 'GINVALID' }), root), /valid Stellar G-address/);
  assert.throws(() => validateConfig(env({ LOCAL_SEED_CONTRIBUTOR: identities.maintainer }), root), /distinct/);
}));

test('refuses writes outside the dedicated fixture directory', () => inTemp((root) => {
  assert.throws(() => validateConfig(env({ LOCAL_SEED_OUTPUT: 'backend/data/bounties.json' }), root), /inside/);
  assert.throws(() => validateConfig(env({ LOCAL_SEED_OUTPUT: '../bounties.json' }), root), /inside/);
}));

test('fixed IDs, timestamp ordering, and valid lifecycle histories', () => {
  const records = fixtureRecords(identities);
  assert.equal(records.length, 6);
  assert.equal(new Set(records.map((x) => x.id)).size, 6);
  for (const item of records) {
    assert.deepEqual(item.events.map((event) => event.type), STATUSES[item.status]);
    assert.equal(item.events[0].type, 'created');
    assert.equal(item.events.every((event, i) => !i || event.timestamp > item.events[i - 1].timestamp), true);
    assert.equal(item.version, item.events.length);
  }
});

test('reruns do not alter IDs, histories, file contents, or status', () => inTemp((root) => {
  const config = validateConfig(env(), root);
  assert.equal(seedFile(config).added, 6);
  const before = fs.readFileSync(config.output, 'utf8');
  assert.equal(seedFile(config).added, 0);
  assert.equal(fs.readFileSync(config.output, 'utf8'), before);
  assert.equal(fs.existsSync(`${config.output}.lock`), false);
}));

test('valid partial JSON is completed without changing existing fixture records', () => inTemp((root) => {
  const config = validateConfig(env(), root);
  fs.mkdirSync(config.base, { recursive: true });
  const partial = fixtureRecords(identities).slice(0, 2);
  fs.writeFileSync(config.output, JSON.stringify(partial));
  assert.equal(seedFile(config).added, 4);
  const full = JSON.parse(fs.readFileSync(config.output, 'utf8'));
  assert.deepEqual(full.slice(0, 2), partial);
  assert.equal(full.length, 6);
}));

test('nested fixture output paths work without writing to the backend store', () => inTemp((root) => {
  const config = validateConfig(env({ LOCAL_SEED_OUTPUT: '.tmp/local-seed-fixtures/nested/bounties.json' }), root);
  assert.equal(seedFile(config).added, 6);
  assert.equal(fs.existsSync(config.output), true);
  assert.equal(fs.existsSync(path.join(root, 'backend/data/bounties.json')), false);
}));

test('truncated JSON halts without changing bytes', () => inTemp((root) => {
  const config = validateConfig(env(), root);
  fs.mkdirSync(config.base, { recursive: true });
  const corrupt = '[{"id":"BNT-9501"},';
  fs.writeFileSync(config.output, corrupt);
  assert.throws(() => seedFile(config), /incomplete or malformed/);
  assert.equal(fs.readFileSync(config.output, 'utf8'), corrupt);
}));

test('changed status history is never silently rewritten', () => inTemp((root) => {
  const config = validateConfig(env(), root);
  seedFile(config);
  const records = JSON.parse(fs.readFileSync(config.output, 'utf8'));
  records[0].status = 'reserved';
  fs.writeFileSync(config.output, JSON.stringify(records));
  const before = fs.readFileSync(config.output, 'utf8');
  assert.throws(() => seedFile(config), /Conflicting or advanced/);
  assert.equal(fs.readFileSync(config.output, 'utf8'), before);
}));

test('duplicate IDs or an existing lock stop without corrupting output', () => inTemp((root) => {
  const config = validateConfig(env(), root);
  seedFile(config);
  const records = JSON.parse(fs.readFileSync(config.output, 'utf8'));
  assert.throws(() => mergeFixtures([records[0], records[0]], fixtureRecords(identities)), /Duplicate/);
  fs.writeFileSync(`${config.output}.lock`, 'another run');
  assert.throws(() => seedFile(config), /EEXIST/);
  assert.equal(fs.readFileSync(`${config.output}.lock`, 'utf8'), 'another run');
}));

if (require.main === module) console.log('Run with: node --test scripts/local-seed-fixtures.test.cjs');
