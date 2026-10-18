import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAppConfig } from '../src/appConfig';

describe('appConfig unit tests (#1298)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_READ_MAX;
    delete process.env.RATE_LIMIT_MUTATION_MAX;
    delete process.env.DEFAULT_PAGE_SIZE;
    delete process.env.MAX_PAGE_SIZE;
    delete process.env.DEFAULT_LEADERBOARD_LIMIT;
    delete process.env.CSV_UPLOAD_LIMIT;
    delete process.env.RAW_BODY_LIMIT;
    delete process.env.OPEN_ISSUES_CACHE_SECONDS;
    delete process.env.BOUNTIES_LIST_CACHE_SECONDS;
    delete process.env.CONFIG_CACHE_SECONDS;
    delete process.env.CONFIG_STALE_WHILE_REVALIDATE_SECONDS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns documented defaults when environment variables are unset', () => {
    const config = getAppConfig();

    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(config.rateLimitReadMax).toBe(120);
    expect(config.rateLimitMutationMax).toBe(10);
    expect(config.defaultPageSize).toBe(20);
    expect(config.maxPageSize).toBe(100);
    expect(config.defaultLeaderboardLimit).toBe(10);
    expect(config.csvUploadLimit).toBe('1mb');
    expect(config.rawBodyLimit).toBe('256kb');
    expect(config.openIssuesCacheSeconds).toBe(600);
    expect(config.bountiesListCacheSeconds).toBe(5);
    expect(config.configCacheSeconds).toBe(300);
    expect(config.configStaleWhileRevalidateSeconds).toBe(60);
  });

  it('respects valid environment variable overrides', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '30000';
    process.env.RATE_LIMIT_READ_MAX = '240';
    process.env.RATE_LIMIT_MUTATION_MAX = '50';
    process.env.DEFAULT_PAGE_SIZE = '25';
    process.env.MAX_PAGE_SIZE = '150';
    process.env.DEFAULT_LEADERBOARD_LIMIT = '20';
    process.env.CSV_UPLOAD_LIMIT = '2mb';
    process.env.RAW_BODY_LIMIT = '512kb';
    process.env.OPEN_ISSUES_CACHE_SECONDS = '1200';
    process.env.BOUNTIES_LIST_CACHE_SECONDS = '15';
    process.env.CONFIG_CACHE_SECONDS = '600';
    process.env.CONFIG_STALE_WHILE_REVALIDATE_SECONDS = '120';

    const config = getAppConfig();

    expect(config.rateLimitWindowMs).toBe(30_000);
    expect(config.rateLimitReadMax).toBe(240);
    expect(config.rateLimitMutationMax).toBe(50);
    expect(config.defaultPageSize).toBe(25);
    expect(config.maxPageSize).toBe(150);
    expect(config.defaultLeaderboardLimit).toBe(20);
    expect(config.csvUploadLimit).toBe('2mb');
    expect(config.rawBodyLimit).toBe('512kb');
    expect(config.openIssuesCacheSeconds).toBe(1200);
    expect(config.bountiesListCacheSeconds).toBe(15);
    expect(config.configCacheSeconds).toBe(600);
    expect(config.configStaleWhileRevalidateSeconds).toBe(120);
  });

  it('falls back safely when environment variables are invalid or negative', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '-100';
    process.env.RATE_LIMIT_READ_MAX = 'invalid';
    process.env.RATE_LIMIT_MUTATION_MAX = '0';
    process.env.DEFAULT_PAGE_SIZE = '   ';
    process.env.CSV_UPLOAD_LIMIT = '   ';

    const config = getAppConfig();

    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(config.rateLimitReadMax).toBe(120);
    expect(config.rateLimitMutationMax).toBe(10);
    expect(config.defaultPageSize).toBe(20);
    expect(config.csvUploadLimit).toBe('1mb');
  });
});
