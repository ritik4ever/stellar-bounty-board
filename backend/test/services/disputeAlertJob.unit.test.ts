import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  scanAndAlertStuckDisputes,
  startDisputeAlertJob,
  stopDisputeAlertJob,
} from '../../src/services/disputeAlertJob';
import type { BountyRecord } from '../../src/services/bountyStore';

describe('services/disputeAlertJob unit tests', () => {
  let tmpDir: string;
  let tmpStorePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispute-alert-test-'));
    tmpStorePath = path.join(tmpDir, 'bounties.json');
    process.env.BOUNTY_STORE_PATH = tmpStorePath;
  });

  afterEach(() => {
    stopDisputeAlertJob();
    delete process.env.BOUNTY_STORE_PATH;
    delete process.env.DISPUTE_SLA_HOURS;
    delete process.env.DISPUTE_ALERT_INTERVAL_HOURS;
    delete process.env.ADMIN_ALERT_EMAIL;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty result when store does not exist', () => {
    const result = scanAndAlertStuckDisputes();
    expect(result.alertedCount).toBe(0);
    expect(result.alertedBountyIds).toEqual([]);
    expect(result.checkedAt).toBeGreaterThan(0);
  });

  it('alerts on disputes that have exceeded the SLA threshold', () => {
    const now = Math.floor(Date.now() / 1000);
    process.env.DISPUTE_SLA_HOURS = '10'; // 10 hours SLA
    process.env.DISPUTE_ALERT_INTERVAL_HOURS = '5'; // 5 hours repeat interval

    const mockBounties: Partial<BountyRecord>[] = [
      {
        id: 'dispute-stuck',
        title: 'Stuck Bounty',
        status: 'disputed',
        disputedAt: now - 3600 * 15, // 15 hours ago (> 10 hrs)
        amount: 100,
        tokenSymbol: 'XLM',
        maintainer: 'alice',
      },
      {
        id: 'dispute-recent',
        title: 'Recent Bounty',
        status: 'disputed',
        disputedAt: now - 3600 * 2, // 2 hours ago (< 10 hrs)
        amount: 50,
        tokenSymbol: 'XLM',
        maintainer: 'bob',
      },
      {
        id: 'dispute-already-alerted',
        title: 'Already Alerted Bounty',
        status: 'disputed',
        disputedAt: now - 3600 * 20,
        lastDisputeAlertAt: now - 3600 * 2, // alerted 2 hrs ago (< 5 hrs interval)
        amount: 75,
        tokenSymbol: 'XLM',
        maintainer: 'charlie',
      },
      {
        id: 'open-bounty',
        title: 'Open Bounty',
        status: 'open',
        createdAt: now - 3600 * 50,
      },
    ];

    fs.mkdirSync(path.dirname(tmpStorePath), { recursive: true });
    fs.writeFileSync(tmpStorePath, JSON.stringify(mockBounties, null, 2), 'utf8');

    const result = scanAndAlertStuckDisputes();
    expect(result.alertedCount).toBe(1);
    expect(result.alertedBountyIds).toEqual(['dispute-stuck']);

    const updated: BountyRecord[] = JSON.parse(fs.readFileSync(tmpStorePath, 'utf8'));
    const stuck = updated.find((b) => b.id === 'dispute-stuck');
    expect(stuck?.lastDisputeAlertAt).toBe(result.checkedAt);
  });

  it('manages timer start and stop without errors', () => {
    fs.mkdirSync(path.dirname(tmpStorePath), { recursive: true });
    fs.writeFileSync(tmpStorePath, '[]', 'utf8');

    startDisputeAlertJob(1000);
    // Duplicate start should be ignored safely
    startDisputeAlertJob(1000);
    stopDisputeAlertJob();
  });
});
