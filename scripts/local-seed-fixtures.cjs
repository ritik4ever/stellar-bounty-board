#!/usr/bin/env node
'use strict';

/**
 * Deterministic, offline-only JSON-backed bounty fixtures. Never signs transactions,
 * connects to an RPC endpoint, or writes to the application's live bounty store.
 *
 * Usage: LOCAL_SEED_NETWORK=testnet LOCAL_SEED_PASSPHRASE='Test SDF Network ; September 2015' \
 *   LOCAL_SEED_MAINTAINER=G... LOCAL_SEED_CONTRIBUTOR=G... LOCAL_SEED_ARBITER=G... \
 *   node scripts/local-seed-fixtures.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const PASSPHRASES = Object.freeze({
  testnet: 'Test SDF Network ; September 2015',
  standalone: 'Standalone Network ; February 2017',
});
const STATUSES = Object.freeze({
  open: ['created'],
  reserved: ['created', 'reserved'],
  submitted: ['created', 'reserved', 'submitted'],
  disputed: ['created', 'reserved', 'submitted', 'disputed'],
  refunded: ['created', 'reserved', 'submitted', 'disputed', 'refunded'],
  released: ['created', 'reserved', 'submitted', 'released'],
});
// Fixed timestamp and ID base ensure deterministic, reproducible fixtures across runs.
// Never use Date.now() or random values in fixture generation.
const BASE_TIMESTAMP = 1793505600; // Fixed fixture timestamp, never Date.now().
const BASE_ID = 9501;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeStrKey(value) {
  if (typeof value !== 'string' || value.length !== 56 || !/^[A-Z2-7]{56}$/.test(value)) return null;
  const bytes = [];
  let bits = 0;
  let acc = 0;
  for (const character of value) {
    acc = (acc << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  if (bits && acc !== 0) return null;
  return Buffer.from(bytes);
}

function crc16xmodem(buffer) {
  let crc = 0;
  for (const byte of buffer) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function isPublicKey(value) {
  const data = decodeStrKey(value);
  if (!data || data.length !== 35 || data[0] !== 6 << 3) return false;
  const checksum = crc16xmodem(data.subarray(0, 33));
  return data[33] === (checksum & 255) && data[34] === (checksum >> 8);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateConfig(env = process.env, root = process.cwd()) {
  if (env.NODE_ENV === 'production') throw new Error('Local seeding is disabled in NODE_ENV=production');
  const network = env.LOCAL_SEED_NETWORK;
  if (!Object.hasOwn(PASSPHRASES, network || '')) {
    throw new Error('LOCAL_SEED_NETWORK must be testnet or standalone (never mainnet)');
  }
  if (env.LOCAL_SEED_PASSPHRASE !== PASSPHRASES[network]) {
    throw new Error('LOCAL_SEED_PASSPHRASE does not match the selected local/testnet network');
  }
  const identities = {
    maintainer: env.LOCAL_SEED_MAINTAINER,
    contributor: env.LOCAL_SEED_CONTRIBUTOR,
    arbiter: env.LOCAL_SEED_ARBITER,
  };
  for (const [label, value] of Object.entries(identities)) {
    if (!isPublicKey(value)) throw new Error(`LOCAL_SEED_${label.toUpperCase()} must be a valid Stellar G-address`);
  }
  if (new Set(Object.values(identities)).size !== 3) {
    throw new Error('Local fixture maintainer, contributor, and arbiter must be distinct public keys');
  }
  // Restrict writes to a dedicated nonproduction tree. No production data path can be passed.
  const base = path.resolve(root, '.tmp', 'local-seed-fixtures');
  const output = path.resolve(root, env.LOCAL_SEED_OUTPUT || '.tmp/local-seed-fixtures/bounties.json');
  if (!isWithin(base, output) || path.extname(output) !== '.json') {
    throw new Error('LOCAL_SEED_OUTPUT must be a .json file inside .tmp/local-seed-fixtures/');
  }
  return { network, output, identities, base };
}

function fixtureRecords(identities) {
  return Object.entries(STATUSES).map(([status, history], index) => {
    const idNumber = BASE_ID + index;
    const timestamp = BASE_TIMESTAMP + index * 3600;
    const events = history.map((type, step) => ({
      type,
      timestamp: timestamp + step * 60,
      actor: type === 'created' || type === 'released' || type === 'refunded'
        ? identities.maintainer : identities.contributor,
    }));
    const record = {
      id: `BNT-${idNumber}`,
      repo: 'local/seed-fixtures',
      issueNumber: idNumber,
      title: `Local seed fixture: ${status}`,
      summary: 'Deterministic offline-only fixture; not backed by a funded token contract.',
      maintainer: identities.maintainer,
      tokenSymbol: 'XLM',
      // Never use this placeholder to construct or submit a transaction.
      tokenAddress: 'OFFLINE_FIXTURE_NO_TOKEN',
      amount: 10,
      labels: ['local-fixture', 'no-live-funds'],
      status,
      createdAt: timestamp,
      deadlineAt: 1893456000,
      version: history.length,
      events,
      reservationTimeoutSeconds: 604800,
    };
    if (history.includes('reserved')) {
      record.contributor = identities.contributor;
      record.reservedAt = timestamp + 60;
    }
    if (history.includes('submitted')) {
      record.submittedAt = timestamp + 120;
      record.submissionUrl = `https://github.com/local/seed-fixtures/pull/${idNumber}`;
    }
    if (history.includes('disputed')) {
      record.disputedAt = timestamp + 180;
      record.disputeReason = 'Offline-only dispute simulation';
    }
    if (history.includes('refunded')) record.refundedAt = timestamp + 240;
    if (history.includes('released')) record.releasedAt = timestamp + 180;
    return record;
  });
}

function assertStoreDocument(records) {
  if (!Array.isArray(records)) throw new Error('Seed file must be a JSON array of bounty records');
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      throw new Error('Seed file contains a record without a valid ID');
    }
    if (ids.has(record.id)) throw new Error(`Duplicate bounty ID in seed file: ${record.id}`);
    ids.add(record.id);
  }
}

function mergeFixtures(existing, expected) {
  assertStoreDocument(existing);
  const byId = new Map(existing.map((record) => [record.id, record]));
  let added = 0;
  for (const fixture of expected) {
    const found = byId.get(fixture.id);
    if (!found) {
      added += 1;
      continue;
    }
    // Do not "repair" changed statuses or re-create history: require manual review.
    if (JSON.stringify(found) !== JSON.stringify(fixture)) {
      throw new Error(`Conflicting or advanced fixture ${fixture.id}; stop and inspect before rerunning`);
    }
  }
  return { records: [...existing, ...expected.filter(({ id }) => !byId.has(id))], added };
}

function seedFile(config) {
  fs.mkdirSync(path.dirname(config.output), { recursive: true });
  const lockPath = `${config.output}.lock`;
  const lock = fs.openSync(lockPath, 'wx');
  let tempPath;
  try {
    if (fs.existsSync(config.output) && fs.lstatSync(config.output).isSymbolicLink()) {
      throw new Error('Refusing to write to a symbolic-link seed file');
    }
    let existing = [];
    if (fs.existsSync(config.output)) {
      const content = fs.readFileSync(config.output, 'utf8');
      try {
        existing = JSON.parse(content);
      } catch {
        throw new Error('Seed JSON is incomplete or malformed; restore a known-good backup before rerunning');
      }
    }
    const { records, added } = mergeFixtures(existing, fixtureRecords(config.identities));
    if (added > 0) {
      tempPath = `${config.output}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(records, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tempPath, config.output);
      tempPath = undefined;
    }
    return { output: config.output, added, unchanged: Object.keys(STATUSES).length - added, total: records.length };
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (require.main === module) {
  try {
    const result = seedFile(validateConfig());
    console.log(`Offline fixtures: ${result.added} added, ${result.unchanged} already present; ${result.total} records in ${result.output}`);
  } catch (error) {
    console.error(`Local seeding stopped before any signing or token transfer: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { PASSPHRASES, STATUSES, isPublicKey, validateConfig, fixtureRecords, assertStoreDocument, mergeFixtures, seedFile };
