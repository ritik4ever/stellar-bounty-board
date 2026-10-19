import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getServicesConfig } from '../../src/services/config';

describe('ServicesConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default values when environment variables are unset', () => {
    delete process.env.BOUNTY_LIST_CACHE_TTL_SECONDS;
    delete process.env.GLOBAL_METRICS_CACHE_TTL_SECONDS;
    delete process.env.OPEN_ISSUES_CACHE_TTL_MS;
    delete process.env.OPEN_ISSUES_DEFAULT_REPO;
    delete process.env.ARCHIVE_JOB_INTERVAL_MS;
    delete process.env.ARCHIVE_AFTER_DAYS;
    delete process.env.RESERVATION_EXPIRATION_INTERVAL_MS;
    delete process.env.RESERVATION_TTL_DAYS;
    delete process.env.DISPUTE_ALERT_JOB_INTERVAL_MS;
    delete process.env.DISPUTE_SLA_HOURS;
    delete process.env.DISPUTE_ALERT_INTERVAL_HOURS;
    delete process.env.RECURRING_SCHEDULER_INTERVAL_MS;

    const config = getServicesConfig();
    expect(config.bountyListCacheTtlSeconds).toBe(5);
    expect(config.globalMetricsCacheTtlSeconds).toBe(30);
    expect(config.openIssuesCacheTtlMs).toBe(600_000);
    expect(config.openIssuesDefaultRepo).toBe('ritik4ever/stellar-bounty-board');
    expect(config.archiveJobIntervalMs).toBe(86_400_000);
    expect(config.archiveRetentionDays).toBe(90);
    expect(config.expirationJobIntervalMs).toBe(3_600_000);
    expect(config.expirationTtlDays).toBe(7);
    expect(config.disputeAlertIntervalMs).toBe(3_600_000);
    expect(config.disputeSlaHours).toBe(72);
    expect(config.disputeAlertIntervalHours).toBe(24);
    expect(config.recurringSchedulerIntervalMs).toBe(60_000);
  });

  it('respects valid environment variable overrides', () => {
    process.env.BOUNTY_LIST_CACHE_TTL_SECONDS = '15';
    process.env.GLOBAL_METRICS_CACHE_TTL_SECONDS = '60';
    process.env.OPEN_ISSUES_CACHE_TTL_MS = '1200000';
    process.env.OPEN_ISSUES_DEFAULT_REPO = 'custom/stellar-board';
    process.env.ARCHIVE_JOB_INTERVAL_MS = '43200000';
    process.env.ARCHIVE_AFTER_DAYS = '30';
    process.env.RESERVATION_EXPIRATION_INTERVAL_MS = '1800000';
    process.env.RESERVATION_TTL_DAYS = '14';
    process.env.DISPUTE_ALERT_JOB_INTERVAL_MS = '1800000';
    process.env.DISPUTE_SLA_HOURS = '48';
    process.env.DISPUTE_ALERT_INTERVAL_HOURS = '12';
    process.env.RECURRING_SCHEDULER_INTERVAL_MS = '30000';

    const config = getServicesConfig();
    expect(config.bountyListCacheTtlSeconds).toBe(15);
    expect(config.globalMetricsCacheTtlSeconds).toBe(60);
    expect(config.openIssuesCacheTtlMs).toBe(1_200_000);
    expect(config.openIssuesDefaultRepo).toBe('custom/stellar-board');
    expect(config.archiveJobIntervalMs).toBe(43_200_000);
    expect(config.archiveRetentionDays).toBe(30);
    expect(config.expirationJobIntervalMs).toBe(1_800_000);
    expect(config.expirationTtlDays).toBe(14);
    expect(config.disputeAlertIntervalMs).toBe(1_800_000);
    expect(config.disputeSlaHours).toBe(48);
    expect(config.disputeAlertIntervalHours).toBe(12);
    expect(config.recurringSchedulerIntervalMs).toBe(30_000);
  });

  it('falls back to safe defaults on invalid/negative inputs', () => {
    process.env.BOUNTY_LIST_CACHE_TTL_SECONDS = '-1';
    process.env.GLOBAL_METRICS_CACHE_TTL_SECONDS = 'abc';
    process.env.DISPUTE_SLA_HOURS = '0';

    const config = getServicesConfig();
    expect(config.bountyListCacheTtlSeconds).toBe(5);
    expect(config.globalMetricsCacheTtlSeconds).toBe(30);
    expect(config.disputeSlaHours).toBe(72);
  });
});
