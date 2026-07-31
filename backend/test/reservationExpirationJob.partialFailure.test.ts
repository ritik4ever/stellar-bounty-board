import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRIBUTOR, MAINTAINER } from './fixtures';

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `expiration-partial-failure-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.RESERVATION_TTL_DAYS;

  try {
    fs.unlinkSync(storeFile);
  } catch {
    // best-effort cleanup
  }

  try {
    fs.unlinkSync(storeFile.replace(/\.json$/i, '.audit.json'));
  } catch {
    // best-effort cleanup
  }
});

async function loadJob() {
  return import('../src/services/reservationExpirationJob');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function makeReservedBounty(id: string, reservedSecondsAgo: number) {
  const now = nowSeconds();

  return {
    id,
    repo: 'test/repo',
    issueNumber: 1,
    title: 'Test bounty for partial failure',
    summary: 'Testing partial failure recovery in expiration job.',
    maintainer: MAINTAINER,
    contributor: CONTRIBUTOR,
    tokenSymbol: 'XLM',
    amount: 100,
    labels: [],
    status: 'reserved' as const,
    createdAt: now - reservedSecondsAgo - 100,
    deadlineAt: now + 9999999,
    reservedAt: now - reservedSecondsAgo,
    version: 1,
    events: [
      { type: 'created' as const, timestamp: now - reservedSecondsAgo - 100 },
      {
        type: 'reserved' as const,
        timestamp: now - reservedSecondsAgo,
        actor: CONTRIBUTOR,
      },
    ],
    reservationTimeoutSeconds: 999999999,
  };
}

describe('ExpirationJob — partial failure recovery', () => {
  it('continues processing remaining bounties when one has a corrupt reservedAt', async () => {
    const now = nowSeconds();

    // Bounty 1: expired (8 days old)
    const bounty1 = makeReservedBounty('BNT-PARTIAL-001', 8 * 24 * 60 * 60);

    // Bounty 2: corrupt reservedAt (null instead of number)
    const bounty2 = makeReservedBounty('BNT-PARTIAL-002', 8 * 24 * 60 * 60);
    (bounty2 as Record<string, unknown>).reservedAt = 'corrupt-string';

    // Bounty 3: expired (10 days old)
    const bounty3 = makeReservedBounty('BNT-PARTIAL-003', 10 * 24 * 60 * 60);

    fs.writeFileSync(storeFile, JSON.stringify([bounty1, bounty2, bounty3], null, 2));

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);

    // The job should have expired the 2 valid ones and skipped the corrupt one
    expect(result.expiredCount).toBe(2);
    expect(result.expiredBountyIds).toContain(bounty1.id);
    expect(result.expiredBountyIds).toContain(bounty3.id);
    expect(result.expiredBountyIds).not.toContain(bounty2.id);

    // Read the updated store and verify
    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));

    const updatedBounty1 = raw.find((item: { id: string }) => item.id === bounty1.id);
    expect(updatedBounty1.status).toBe('open');

    const updatedBounty2 = raw.find((item: { id: string }) => item.id === bounty2.id);
    // Corrupt bounty should still be 'reserved' since it could not be evaluated
    expect(updatedBounty2.status).toBe('reserved');

    const updatedBounty3 = raw.find((item: { id: string }) => item.id === bounty3.id);
    expect(updatedBounty3.status).toBe('open');
  });

  it('handles missing reservedAt field gracefully', async () => {
    const now = nowSeconds();

    // Bounty with no reservedAt at all
    const noReservedAt = {
      id: 'BNT-NO-RESERVED',
      repo: 'test/repo',
      issueNumber: 1,
      title: 'No reservedAt',
      summary: 'Bounty missing reservedAt field.',
      maintainer: MAINTAINER,
      contributor: CONTRIBUTOR,
      tokenSymbol: 'XLM',
      amount: 100,
      labels: [],
      status: 'reserved' as const,
      createdAt: now - 20 * 24 * 60 * 60,
      deadlineAt: now + 9999999,
      version: 1,
      events: [
        { type: 'created' as const, timestamp: now - 20 * 24 * 60 * 60 },
        {
          type: 'reserved' as const,
          timestamp: now - 20 * 24 * 60 * 60,
          actor: CONTRIBUTOR,
        },
      ],
      reservationTimeoutSeconds: 999999999,
    };

    // Valid expired bounty
    const validExpired = makeReservedBounty('BNT-VALID-EXPIRED', 8 * 24 * 60 * 60);

    fs.writeFileSync(storeFile, JSON.stringify([noReservedAt, validExpired], null, 2));

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);

    // Only the valid expired bounty should be expired
    expect(result.expiredCount).toBe(1);
    expect(result.expiredBountyIds).toContain(validExpired.id);
    expect(result.expiredBountyIds).not.toContain(noReservedAt.id);

    // The corrupt bounty should remain unchanged
    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const unchanged = raw.find((item: { id: string }) => item.id === noReservedAt.id);
    expect(unchanged.status).toBe('reserved');

    const valid = raw.find((item: { id: string }) => item.id === validExpired.id);
    expect(valid.status).toBe('open');
  });

  it('does not crash when the store contains non-reserved bounties with missing fields', async () => {
    const now = nowSeconds();

    // A malformed bounty with status 'open' but no version field
    const malformed = {
      id: 'BNT-MALFORMED',
      repo: 'test/repo',
      issueNumber: 1,
      title: 'Malformed',
      summary: 'A malformed bounty record.',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 100,
      labels: [],
      status: 'open' as const,
      createdAt: now - 100,
      deadlineAt: now + 9999999,
      events: [{ type: 'created' as const, timestamp: now - 100 }],
    };

    // Valid expired bounty
    const validStale = makeReservedBounty('BNT-STALE', 8 * 24 * 60 * 60);

    fs.writeFileSync(storeFile, JSON.stringify([malformed, validStale], null, 2));

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);

    // Should have expired the valid stale bounty
    expect(result.expiredCount).toBe(1);
    expect(result.expiredBountyIds).toContain(validStale.id);

    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const updatedStale = raw.find((item: { id: string }) => item.id === validStale.id);
    expect(updatedStale.status).toBe('open');

    const preservedMalformed = raw.find((item: { id: string }) => item.id === malformed.id);
    expect(preservedMalformed.status).toBe('open');
  });
});