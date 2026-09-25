import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS worker module, no type declarations
import { loadIndexerConfig, INDEXER_DEFAULTS } from '../worker/indexerConfig.js';

describe('loadIndexerConfig (#1327)', () => {
  it('defaults match the values previously hardcoded in worker/indexer.js', () => {
    expect(loadIndexerConfig({})).toEqual({
      pollIntervalMs: 10_000,
      maxRetries: 5,
      initialBackoffMs: 1000,
    });
    expect(INDEXER_DEFAULTS).toEqual({ pollIntervalSeconds: 10, maxRetries: 5, initialBackoffMs: 1000 });
  });

  it('reads overrides from the environment (poll interval given in seconds)', () => {
    expect(
      loadIndexerConfig({
        SOROBAN_POLL_INTERVAL: '30',
        SOROBAN_INDEXER_MAX_RETRIES: '8',
        SOROBAN_INDEXER_INITIAL_BACKOFF_MS: '250',
      }),
    ).toEqual({ pollIntervalMs: 30_000, maxRetries: 8, initialBackoffMs: 250 });
  });

  it('accepts a fractional poll interval', () => {
    expect(loadIndexerConfig({ SOROBAN_POLL_INTERVAL: '0.5' }).pollIntervalMs).toBe(500);
  });

  it('floors max retries to a whole number', () => {
    expect(loadIndexerConfig({ SOROBAN_INDEXER_MAX_RETRIES: '3.9' }).maxRetries).toBe(3);
  });

  it.each(['abc', '0', '-1', 'Infinity', ''])('falls back to defaults (never throws) for %j', (raw) => {
    expect(
      loadIndexerConfig({
        SOROBAN_POLL_INTERVAL: raw,
        SOROBAN_INDEXER_MAX_RETRIES: raw,
        SOROBAN_INDEXER_INITIAL_BACKOFF_MS: raw,
      }),
    ).toEqual({ pollIntervalMs: 10_000, maxRetries: 5, initialBackoffMs: 1000 });
  });

  it('max retries below 1 (e.g. 0.5) falls back rather than producing zero attempts', () => {
    expect(loadIndexerConfig({ SOROBAN_INDEXER_MAX_RETRIES: '0.5' }).maxRetries).toBe(5);
  });
});
