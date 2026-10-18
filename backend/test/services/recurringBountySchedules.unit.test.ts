import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  listRecurringSchedules,
  createRecurringSchedule,
  cancelRecurringSchedule,
  runDueRecurringSchedules,
  stopRecurringBountyScheduler,
} from '../../src/services/recurringBountySchedules';

describe('services/recurringBountySchedules unit tests', () => {
  let tmpDir: string;
  let tmpStorePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recurring-schedules-test-'));
    tmpStorePath = path.join(tmpDir, 'schedules.json');
    process.env.RECURRING_BOUNTY_STORE_PATH = tmpStorePath;
  });

  afterEach(() => {
    stopRecurringBountyScheduler();
    delete process.env.RECURRING_BOUNTY_STORE_PATH;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lists empty array when schedule store file does not exist', () => {
    expect(listRecurringSchedules()).toEqual([]);
  });

  it('creates and persists a new recurring schedule', () => {
    const schedule = createRecurringSchedule({
      cadence: 'weekly',
      templateId: 'small-bug-fix',
      targetRepo: 'ritik4ever/stellar-bounty-board',
      bounty: {
        title: 'Weekly bug fix task',
        summary: 'Automated weekly bug bounty',
        maintainer: 'maintainer-1',
        tokenSymbol: 'XLM',
        amount: 50,
        deadlineDays: 7,
      },
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.cadence).toBe('weekly');
    expect(schedule.active).toBe(true);
    expect(schedule.createdBountyIds).toEqual([]);

    const all = listRecurringSchedules();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(schedule.id);
  });

  it('cancels an active recurring schedule', () => {
    const schedule = createRecurringSchedule({
      cadence: 'daily',
      templateId: 'documentation',
      targetRepo: 'ritik4ever/stellar-bounty-board',
      bounty: {
        title: 'Daily docs update',
        summary: 'Check and update docs',
        maintainer: 'maintainer-1',
        tokenSymbol: 'XLM',
        amount: 25,
        deadlineDays: 3,
      },
    });

    const cancelled = cancelRecurringSchedule(schedule.id);
    expect(cancelled.active).toBe(false);

    const reloaded = listRecurringSchedules().find((s) => s.id === schedule.id);
    expect(reloaded?.active).toBe(false);
  });

  it('throws when cancelling a non-existent schedule', () => {
    expect(() => cancelRecurringSchedule('non-existent-schedule-id')).toThrow(
      'Recurring bounty schedule not found.',
    );
  });

  it('skips inactive schedules when running due schedules', async () => {
    const schedule = createRecurringSchedule({
      cadence: 'daily',
      templateId: 'feature',
      targetRepo: 'ritik4ever/stellar-bounty-board',
      bounty: {
        title: 'Inactive feature',
        summary: 'Should not run',
        maintainer: 'maintainer-1',
        tokenSymbol: 'XLM',
        amount: 100,
        deadlineDays: 14,
      },
      startAt: 1000,
    });
    cancelRecurringSchedule(schedule.id);

    const created = await runDueRecurringSchedules(2000);
    expect(created).toEqual([]);
  });
});
