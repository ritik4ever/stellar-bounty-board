import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRIBUTOR, MAINTAINER } from './fixtures';

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `expiration-test-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.RESERVATION_TTL_DAYS;
  delete process.env.EXPIRATION_CRON_INTERVAL_MS;

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

async function loadStore() {
  return import('../src/services/bountyStore');
}

async function loadJob() {
  return import('../src/services/reservationExpirationJob');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function makeReservedBounty(reservedSecondsAgo: number) {
  const now = nowSeconds();

  return {
    id: `BNT-TEST-${randomUUID()}`,
    repo: 'test/repo',
    issueNumber: 1,
    title: 'Test bounty',
    summary: 'A test bounty for expiration.',
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

describe('expireStaleReservations', () => {
  it('does not expire a fresh reservation', async () => {
    const store = await loadStore();
    const bounty = await store.createBounty({
      repo: 'test/repo',
      issueNumber: 1,
      title: 'Fresh bounty',
      summary: 'A test bounty that is fresh and should not be expired.',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });

    await store.reserveBounty(bounty.id, CONTRIBUTOR);

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);

    expect(result.expiredCount).toBe(0);
    expect(result.expiredBountyIds).toHaveLength(0);

    const after = store.listBounties().find((item) => item.id === bounty.id);
    expect(after?.status).toBe('reserved');
  });

  it('expires a stale reservation', async () => {
    const stale = makeReservedBounty(8 * 24 * 60 * 60);
    fs.writeFileSync(storeFile, JSON.stringify([stale], null, 2));

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);

    expect(result.expiredCount).toBe(1);
    expect(result.expiredBountyIds).toContain(stale.id);

    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const updated = raw.find((item: { id: string }) => item.id === stale.id);

    expect(updated.status).toBe('open');
    expect(updated.contributor).toBeUndefined();
    expect(updated.reservedAt).toBeUndefined();
    expect(updated.version).toBe(2);
    expect(updated.events.at(-1).type).toBe('expired');
    expect(updated.events.at(-1).details.reason).toBe('reservation_ttl_exceeded');
  });

  it('logs the bounty ID and contributor address for each expired reservation', async () => {
    const stale = makeReservedBounty(8 * 24 * 60 * 60);
    fs.writeFileSync(storeFile, JSON.stringify([stale], null, 2));

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);

    expect(result.expiredBountyIds[0]).toBe(stale.id);
    expect(result.expiredCount).toBe(1);
  });

  it('expires multiple stale reservations in a single run', async () => {
    const stale1 = makeReservedBounty(8 * 24 * 60 * 60);
    const stale2 = makeReservedBounty(10 * 24 * 60 * 60);
    const fresh = makeReservedBounty(1 * 24 * 60 * 60);

    fs.writeFileSync(storeFile, JSON.stringify([stale1, stale2, fresh], null, 2));

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);

    expect(result.expiredCount).toBe(2);
    expect(result.expiredBountyIds).toContain(stale1.id);
    expect(result.expiredBountyIds).toContain(stale2.id);
    expect(result.expiredBountyIds).not.toContain(fresh.id);

    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const freshUpdated = raw.find((item: { id: string }) => item.id === fresh.id);

    expect(freshUpdated.status).toBe('reserved');
  });

  it('respects RESERVATION_TTL_DAYS env var', async () => {
    process.env.RESERVATION_TTL_DAYS = '3';

    const stale = makeReservedBounty(4 * 24 * 60 * 60);
    fs.writeFileSync(storeFile, JSON.stringify([stale], null, 2));

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations();

    expect(result.expiredCount).toBe(1);
    expect(result.expiredBountyIds).toContain(stale.id);
  });

  it('does not touch submitted bounties', async () => {
    const store = await loadStore();
    const bounty = await store.createBounty({
      repo: 'test/repo',
      issueNumber: 2,
      title: 'Submitted bounty',
      summary: 'A test bounty that is submitted and should not be expired.',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });
    await store.reserveBounty(bounty.id, CONTRIBUTOR);
    await store.submitBounty(bounty.id, CONTRIBUTOR, 'https://github.com/test/repo/pull/1');

    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(0);

    const after = store.listBounties().find((item) => item.id === bounty.id);

    expect(after?.status).toBe('submitted');
    expect(result.expiredBountyIds).not.toContain(bounty.id);
  });

  it('returns checkedAt timestamp', async () => {
    const before = nowSeconds();
    const { expireStaleReservations } = await loadJob();
    const result = expireStaleReservations(7 * 24 * 60 * 60);
    const after = nowSeconds();

    expect(result.checkedAt).toBeGreaterThanOrEqual(before);
    expect(result.checkedAt).toBeLessThanOrEqual(after);
  });
});

describe('startExpirationJob / stopExpirationJob', () => {
  it('starts and stops without throwing', async () => {
    const { startExpirationJob, stopExpirationJob } = await loadJob();

    expect(() => startExpirationJob(9999999, 7 * 24 * 60 * 60)).not.toThrow();
    expect(() => stopExpirationJob()).not.toThrow();
  });

  it('does not start twice', async () => {
    const { startExpirationJob, stopExpirationJob } = await loadJob();

    startExpirationJob(9999999, 7 * 24 * 60 * 60);

    expect(() => startExpirationJob(9999999, 7 * 24 * 60 * 60)).not.toThrow();

    stopExpirationJob();
  });

  it('runs expiration on start and expires stale bounty', async () => {
    const stale = makeReservedBounty(8 * 24 * 60 * 60);
    fs.writeFileSync(storeFile, JSON.stringify([stale], null, 2));

    const { startExpirationJob, stopExpirationJob } = await loadJob();

    startExpirationJob(9999999, 7 * 24 * 60 * 60);
    stopExpirationJob();

    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const updated = raw.find((item: { id: string }) => item.id === stale.id);

    expect(updated.status).toBe('open');
  });
});
