#!/usr/bin/env node
'use strict';

/**
 * Quick validation script for local seed fixtures (SBB-2026-490).
 * Verifies deterministic IDs, valid status histories, and offline-only configuration.
 * 
 * Usage: node scripts/verify-fixtures.cjs
 */

const { fixtureRecords, STATUSES, isPublicKey } = require('./local-seed-fixtures.cjs');

const EXPECTED_STATUSES = ['open', 'reserved', 'submitted', 'disputed', 'refunded', 'released'];
const EXPECTED_IDS = ['BNT-9501', 'BNT-9502', 'BNT-9503', 'BNT-9504', 'BNT-9505', 'BNT-9506'];

function verify() {
  // Use test identities
  const identities = {
    maintainer: 'GCFTHI4TAKQL5SXF47LFWXTEJJWNVRYW5KBIJ5BTPEXXVANCC3NJM5GK',
    contributor: 'GAJ6XLOYGSLAY777ULNR6ASP6NKIVMKA43EIUDJNNMR26O5JGEH6R5T4',
    arbiter: 'GDD3QRG4NE6M53UXQXRZTD27P7WFW3QICDXY3C4ZRRSAYCHGQ22AU5WD',
  };

  console.log('Verifying local seed fixtures...\n');

  const records = fixtureRecords(identities);

  // Check count
  if (records.length !== 6) {
    throw new Error(`Expected 6 fixtures, got ${records.length}`);
  }
  console.log('✓ Fixture count: 6');

  // Check deterministic IDs
  const ids = records.map((r) => r.id);
  for (let i = 0; i < EXPECTED_IDS.length; i++) {
    if (ids[i] !== EXPECTED_IDS[i]) {
      throw new Error(`Expected ID ${EXPECTED_IDS[i]}, got ${ids[i]}`);
    }
  }
  console.log('✓ Deterministic IDs: BNT-9501 through BNT-9506');

  // Check all statuses present
  const statuses = new Set(records.map((r) => r.status));
  for (const status of EXPECTED_STATUSES) {
    if (!statuses.has(status)) {
      throw new Error(`Missing status fixture: ${status}`);
    }
  }
  console.log('✓ All required statuses present: open, reserved, submitted, disputed, refunded, released');

  // Check event histories match status definitions
  for (const record of records) {
    const expectedHistory = STATUSES[record.status];
    const actualHistory = record.events.map((e) => e.type);
    if (JSON.stringify(actualHistory) !== JSON.stringify(expectedHistory)) {
      throw new Error(`Status ${record.status} history mismatch: expected ${expectedHistory}, got ${actualHistory}`);
    }
  }
  console.log('✓ Event histories match status definitions');

  // Check no live funds
  for (const record of records) {
    if (record.tokenAddress !== 'OFFLINE_FIXTURE_NO_TOKEN') {
      throw new Error(`Record ${record.id} has non-offline token address: ${record.tokenAddress}`);
    }
    if (!record.labels.includes('local-fixture') || !record.labels.includes('no-live-funds')) {
      throw new Error(`Record ${record.id} missing safety labels`);
    }
  }
  console.log('✓ All fixtures use offline token placeholder and safety labels');

  // Check timestamp ordering
  for (const record of records) {
    for (let i = 1; i < record.events.length; i++) {
      if (record.events[i].timestamp <= record.events[i - 1].timestamp) {
        throw new Error(`Record ${record.id} has non-monotonic timestamps`);
      }
    }
  }
  console.log('✓ Event timestamps are strictly monotonic');

  // Check version matches event count
  for (const record of records) {
    if (record.version !== record.events.length) {
      throw new Error(`Record ${record.id} version ${record.version} does not match event count ${record.events.length}`);
    }
  }
  console.log('✓ Version numbers match event counts');

  // Check specific status fields
  const reserved = records.find((r) => r.status === 'reserved');
  if (!reserved.contributor || !reserved.reservedAt) {
    throw new Error('Reserved fixture missing contributor or reservedAt');
  }

  const submitted = records.find((r) => r.status === 'submitted');
  if (!submitted.submittedAt || !submitted.submissionUrl) {
    throw new Error('Submitted fixture missing submittedAt or submissionUrl');
  }

  const disputed = records.find((r) => r.status === 'disputed');
  if (!disputed.disputedAt || !disputed.disputeReason) {
    throw new Error('Disputed fixture missing disputedAt or disputeReason');
  }

  const refunded = records.find((r) => r.status === 'refunded');
  if (!refunded.refundedAt) {
    throw new Error('Refunded fixture missing refundedAt');
  }

  const released = records.find((r) => r.status === 'released');
  if (!released.releasedAt) {
    throw new Error('Released fixture missing releasedAt');
  }
  console.log('✓ Status-specific fields are present');

  console.log('\n✅ All validations passed! Fixtures are deterministic and safe for testing.');
}

if (require.main === module) {
  try {
    verify();
  } catch (error) {
    console.error(`\n❌ Validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verify };
