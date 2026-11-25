import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  archiveOldBounties,
  startArchiveJob,
  stopArchiveJob,
} from '../../src/services/archiveScheduler';
import type { BountyRecord } from '../../src/services/bountyStore';
import { createBounty, listBounties } from '../../src/services/bountyStore';
import { MAINTAINER } from '../fixtures';

describe('services/archiveScheduler unit tests', () => {
  let tmpDir: string;
  let tmpStorePath: string;
  let tmpArchivePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-scheduler-test-'));
    tmpStorePath = path.join(tmpDir, 'bounties.json');
    tmpArchivePath = path.join(tmpDir, 'bounties.archive.json');
    process.env.BOUNTY_STORE_PATH = tmpStorePath;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stopArchiveJob();
    delete process.env.BOUNTY_STORE_PATH;
    delete process.env.ARCHIVE_AFTER_DAYS;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty result when store does not exist', async () => {
    const res = await archiveOldBounties(3600);
    expect(res.archivedCount).toBe(0);
    expect(res.archivedBountyIds).toEqual([]);
    expect(res.checkedAt).toBeGreaterThan(0);
  });

  it('moves old terminal records to a cold file and leaves hot reads small', async () => {
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

    const result = await archiveOldBounties(5000);
    expect(result.archivedCount).toBe(3);
    expect(result.archivedBountyIds).toEqual(['b-1', 'b-2', 'b-5']);

    const updated: BountyRecord[] = JSON.parse(fs.readFileSync(tmpStorePath, 'utf8'));
    const archived: BountyRecord[] = JSON.parse(fs.readFileSync(tmpArchivePath, 'utf8'));
    const b1 = archived.find((b) => b.id === 'b-1');
    const b2 = archived.find((b) => b.id === 'b-2');
    const b3 = updated.find((b) => b.id === 'b-3');
    const b4 = updated.find((b) => b.id === 'b-4');

    expect(b1?.archived).toBe(true);
    expect(b1?.archivedAt).toBe(result.checkedAt);
    expect(b1?.events).toContainEqual(
      expect.objectContaining({
        type: 'archived',
        details: { reason: 'retention_window_exceeded', retentionSeconds: 5000 },
      })
    );

    expect(b2?.archived).toBe(true);
    expect(b3?.archived).toBe(false);
    expect(b4?.archived).toBe(false);
    expect(updated.map((b) => b.id)).toEqual(['b-3', 'b-4']);
    expect(listBounties().map((b) => b.id)).not.toContain('b-1');
    expect((await archiveOldBounties(5000)).archivedCount).toBe(0);
    expect(JSON.parse(fs.readFileSync(tmpArchivePath, 'utf8'))).toHaveLength(3);
  });

  it('manages timer start and stop without errors', () => {
    fs.mkdirSync(path.dirname(tmpStorePath), { recursive: true });
    fs.writeFileSync(tmpStorePath, '[]', 'utf8');

    startArchiveJob(1000, 3600);
    // Duplicate start should be ignored safely
    startArchiveJob(1000, 3600);
    stopArchiveJob();
  });

  it('does not parse the archive for list reads and does not reuse archived IDs', async () => {
    fs.writeFileSync(tmpStorePath, '[]');
    fs.writeFileSync(tmpArchivePath, 'not json');
    expect(listBounties()).toEqual([]);
    fs.writeFileSync(tmpArchivePath, JSON.stringify([{ id: 'BNT-9999' }]));

    const created = await createBounty({
      repo: 'acme/widget',
      issueNumber: 1,
      title: 'Archive ID test',
      summary: 'Ensure archived IDs are not reused',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 10,
      deadlineDays: 7,
      labels: [],
    });
    expect(created.id).toBe('BNT-10000');
  });

  it('retries safely after the archive write succeeds but active write fails', async () => {
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      tmpStorePath,
      JSON.stringify([
        {
          id: 'BNT-0003',
          status: 'released',
          createdAt: now - 10000,
          releasedAt: now - 9000,
        },
      ])
    );
    const rename = fs.renameSync.bind(fs);
    const mocked = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === tmpStorePath) throw new Error('simulated active write failure');
      return rename(from, to);
    });
    await expect(archiveOldBounties(5000)).rejects.toThrow();
    mocked.mockRestore();
    expect(JSON.parse(fs.readFileSync(tmpArchivePath, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(tmpStorePath, 'utf8'))).toHaveLength(1);
    expect((await archiveOldBounties(5000)).archivedCount).toBe(1);
    expect(JSON.parse(fs.readFileSync(tmpArchivePath, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(tmpStorePath, 'utf8'))).toHaveLength(0);
  });
});
