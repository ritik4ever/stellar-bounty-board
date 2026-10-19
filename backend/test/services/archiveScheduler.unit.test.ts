import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  archiveOldBounties,
  startArchiveJob,
  stopArchiveJob,
} from '../../src/services/archiveScheduler';
import type { BountyRecord } from '../../src/services/bountyStore';

describe('services/archiveScheduler unit tests', () => {
  let tmpDir: string;
  let tmpStorePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-scheduler-test-'));
    tmpStorePath = path.join(tmpDir, 'bounties.json');
    process.env.BOUNTY_STORE_PATH = tmpStorePath;
  });

  afterEach(() => {
    stopArchiveJob();
    delete process.env.BOUNTY_STORE_PATH;
    delete process.env.ARCHIVE_AFTER_DAYS;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty result when store does not exist', () => {
    const res = archiveOldBounties(3600);
    expect(res.archivedCount).toBe(0);
    expect(res.archivedBountyIds).toEqual([]);
    expect(res.checkedAt).toBeGreaterThan(0);
  });

  it('archives released and refunded bounties older than retentionSeconds', () => {
    const now = Math.floor(Date.now() / 1000);
    const mockBounties: Partial<BountyRecord>[] = [
      {
        id: 'b-1',
        status: 'released',
        releasedAt: now - 10000,
        createdAt: now - 20000,
        archived: false,
      },
      {
        id: 'b-2',
        status: 'refunded',
        refundedAt: now - 10000,
        createdAt: now - 20000,
        archived: false,
      },
      {
        id: 'b-3',
        status: 'open',
        createdAt: now - 20000,
        archived: false,
      },
      {
        id: 'b-4',
        status: 'released',
        releasedAt: now - 100, // within retention window
        createdAt: now - 500,
        archived: false,
      },
      {
        id: 'b-5',
        status: 'released',
        releasedAt: now - 10000,
        createdAt: now - 20000,
        archived: true, // already archived
      },
    ];

    fs.mkdirSync(path.dirname(tmpStorePath), { recursive: true });
    fs.writeFileSync(tmpStorePath, JSON.stringify(mockBounties, null, 2), 'utf8');

    const result = archiveOldBounties(5000);
    expect(result.archivedCount).toBe(2);
    expect(result.archivedBountyIds).toEqual(['b-1', 'b-2']);

    const updated: BountyRecord[] = JSON.parse(fs.readFileSync(tmpStorePath, 'utf8'));
    const b1 = updated.find((b) => b.id === 'b-1');
    const b2 = updated.find((b) => b.id === 'b-2');
    const b3 = updated.find((b) => b.id === 'b-3');
    const b4 = updated.find((b) => b.id === 'b-4');

    expect(b1?.archived).toBe(true);
    expect(b1?.archivedAt).toBe(result.checkedAt);
    expect(b1?.events).toContainEqual(
      expect.objectContaining({
        type: 'archived',
        details: { reason: 'retention_window_exceeded', retentionSeconds: 5000 },
      }),
    );

    expect(b2?.archived).toBe(true);
    expect(b3?.archived).toBe(false);
    expect(b4?.archived).toBe(false);
  });

  it('manages timer start and stop without errors', () => {
    fs.mkdirSync(path.dirname(tmpStorePath), { recursive: true });
    fs.writeFileSync(tmpStorePath, '[]', 'utf8');

    startArchiveJob(1000, 3600);
    // Duplicate start should be ignored safely
    startArchiveJob(1000, 3600);
    stopArchiveJob();
  });
});
