import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPublicConfig } from '../src/config';

const ENV_KEYS = [
  'PROTOCOL_FEE_BPS',
  'DISPUTE_WINDOW_SECONDS',
  'MIN_BOUNTY_AMOUNT',
  'MAX_BOUNTY_AMOUNT',
  'RESERVATION_TTL_DAYS',
  'ALLOWED_TOKEN_SYMBOLS',
  'SOROBAN_NETWORK_PASSPHRASE',
  'STELLAR_NETWORK',
];

describe('getPublicConfig', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('returns sensible defaults when no environment variables are set', () => {
    const config = getPublicConfig();

    expect(config.feeBps).toBe(0);
    expect(config.disputeWindowSeconds).toBe(0);
    expect(config.minBountyAmount).toBe(1);
    expect(config.maxBountyAmount).toBe(10_000);
    expect(config.defaultReservationTtlSeconds).toBe(604_800);
    expect(config.network).toBe('futurenet');
    expect(config.supportedTokens).toHaveProperty('XLM');
  });

  it('parses valid environment values', () => {
    process.env.PROTOCOL_FEE_BPS = '250';
    process.env.DISPUTE_WINDOW_SECONDS = '604800';
    process.env.MIN_BOUNTY_AMOUNT = '5';
    process.env.MAX_BOUNTY_AMOUNT = '500';
    process.env.RESERVATION_TTL_DAYS = '3';
    process.env.STELLAR_NETWORK = 'testnet';

    const config = getPublicConfig();

    expect(config.feeBps).toBe(250);
    expect(config.disputeWindowSeconds).toBe(604_800);
    expect(config.minBountyAmount).toBe(5);
    expect(config.maxBountyAmount).toBe(500);
    expect(config.defaultReservationTtlSeconds).toBe(259_200);
    expect(config.network).toBe('testnet');
  });

  it('falls back to defaults for invalid numeric values', () => {
    process.env.PROTOCOL_FEE_BPS = 'not-a-number';
    process.env.DISPUTE_WINDOW_SECONDS = '-5';
    process.env.MIN_BOUNTY_AMOUNT = '0';
    process.env.MAX_BOUNTY_AMOUNT = 'NaN';
    process.env.RESERVATION_TTL_DAYS = '-1';

    const config = getPublicConfig();

    expect(config.feeBps).toBe(0);
    expect(config.disputeWindowSeconds).toBe(0);
    expect(config.minBountyAmount).toBe(1);
    expect(config.maxBountyAmount).toBe(10_000);
    expect(config.defaultReservationTtlSeconds).toBe(604_800);
  });

  it('clamps fee bps above 10000 back to the default', () => {
    process.env.PROTOCOL_FEE_BPS = '20000';

    expect(getPublicConfig().feeBps).toBe(0);
  });

  it('filters supported tokens by the allowlist', () => {
    process.env.ALLOWED_TOKEN_SYMBOLS = 'xlm, usdc , ';
    process.env.MIN_BOUNTY_AMOUNT = '1';

    const config = getPublicConfig();
    const symbols = Object.keys(config.supportedTokens);

    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.every((s) => s === 'XLM' || s === 'USDC')).toBe(true);
  });

  it('uses only allowlisted symbols that resolve to a known token address', () => {
    process.env.ALLOWED_TOKEN_SYMBOLS = 'XLM,NOT-A-REAL-TOKEN';
    process.env.MIN_BOUNTY_AMOUNT = '1';

    const config = getPublicConfig();

    expect(config.supportedTokens).toHaveProperty('XLM');
    expect(config.supportedTokens['NOT-A-REAL-TOKEN']).toBeUndefined();
  });

  it('derives the network label from the Soroban network passphrase', () => {
    process.env.SOROBAN_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
    expect(getPublicConfig().network).toBe('mainnet');

    process.env.SOROBAN_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
    expect(getPublicConfig().network).toBe('testnet');

    process.env.SOROBAN_NETWORK_PASSPHRASE = 'Test SDF Future Network ; October 2022';
    expect(getPublicConfig().network).toBe('futurenet');
  });

  it('exposes only non-sensitive keys', () => {
    const config = getPublicConfig();

    expect(Object.keys(config).sort()).toEqual(
      [
        'defaultReservationTtlSeconds',
        'disputeWindowSeconds',
        'feeBps',
        'maxBountyAmount',
        'minBountyAmount',
        'network',
        'supportedTokens',
      ].sort()
    );
  });
});
