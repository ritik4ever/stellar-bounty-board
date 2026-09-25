import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// getPublicConfig delegates token resolution to getTokenAddressMap. Wrap it so
// individual tests can make it throw (to assert error propagation) while every
// other test exercises the real implementation.
const tokenMap = vi.hoisted(() => ({ override: null as null | (() => Record<string, string>) }));

vi.mock('../src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils')>();
  return {
    ...actual,
    getTokenAddressMap: () => (tokenMap.override ? tokenMap.override() : actual.getTokenAddressMap()),
  };
});

import { getPublicConfig } from '../src/config';

const ENV_KEYS = [
  'PROTOCOL_FEE_BPS',
  'DISPUTE_WINDOW_SECONDS',
  'MIN_BOUNTY_AMOUNT',
  'MAX_BOUNTY_AMOUNT',
  'RESERVATION_TTL_DAYS',
  'ALLOWED_TOKEN_SYMBOLS',
  'TOKEN_ADDRESS_MAP',
  'SOROBAN_NETWORK_PASSPHRASE',
  'STELLAR_NETWORK',
];

describe('getPublicConfig (#1328)', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // Also clear any TOKEN_ADDR_* / TOKEN_ADDRESS_* the host shell may define.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('TOKEN_ADDR_') || key.startsWith('TOKEN_ADDRESS_')) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    }
    tokenMap.override = null;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    tokenMap.override = null;
    vi.restoreAllMocks();
  });

  describe('defaults', () => {
    it('returns documented defaults when nothing is set', () => {
      const config = getPublicConfig();
      expect(config).toMatchObject({
        feeBps: 0,
        disputeWindowSeconds: 0,
        minBountyAmount: 1,
        maxBountyAmount: 10_000,
        defaultReservationTtlSeconds: 604_800,
        network: 'futurenet',
      });
      expect(Object.keys(config.supportedTokens)).toEqual(expect.arrayContaining(['XLM', 'USDC']));
    });

    it('never returns null/undefined for any field', () => {
      for (const value of Object.values(getPublicConfig())) {
        expect(value).not.toBeNull();
        expect(value).not.toBeUndefined();
      }
    });
  });

  describe('feeBps (PROTOCOL_FEE_BPS)', () => {
    it.each([
      ['0', 0],
      ['250', 250],
      ['250.9', 250], // floored
      ['10000', 10_000], // upper boundary is inclusive
    ])('accepts %s -> %d', (raw, expected) => {
      process.env.PROTOCOL_FEE_BPS = raw;
      expect(getPublicConfig().feeBps).toBe(expected);
    });

    it.each(['10001', '-1', 'abc', 'NaN', 'Infinity'])('falls back to 0 for %s (not clamped)', (raw) => {
      process.env.PROTOCOL_FEE_BPS = raw;
      expect(getPublicConfig().feeBps).toBe(0);
    });
  });

  describe('disputeWindowSeconds (DISPUTE_WINDOW_SECONDS)', () => {
    it.each([
      ['0', 0],
      ['3600', 3600],
      ['59.9', 59],
    ])('accepts %s -> %d', (raw, expected) => {
      process.env.DISPUTE_WINDOW_SECONDS = raw;
      expect(getPublicConfig().disputeWindowSeconds).toBe(expected);
    });

    it.each(['-1', 'abc', 'Infinity'])('falls back to 0 for %s', (raw) => {
      process.env.DISPUTE_WINDOW_SECONDS = raw;
      expect(getPublicConfig().disputeWindowSeconds).toBe(0);
    });
  });

  describe('min/max bounty amounts', () => {
    it('accepts fractional positive values without rounding', () => {
      process.env.MIN_BOUNTY_AMOUNT = '0.5';
      process.env.MAX_BOUNTY_AMOUNT = '2500.75';
      const config = getPublicConfig();
      expect(config.minBountyAmount).toBe(0.5);
      expect(config.maxBountyAmount).toBe(2500.75);
    });

    it.each(['0', '-5', 'abc', 'Infinity'])('falls back to defaults for %s', (raw) => {
      process.env.MIN_BOUNTY_AMOUNT = raw;
      process.env.MAX_BOUNTY_AMOUNT = raw;
      const config = getPublicConfig();
      expect(config.minBountyAmount).toBe(1);
      expect(config.maxBountyAmount).toBe(10_000);
    });

    it('does not cross-check min against max (documented behaviour)', () => {
      process.env.MIN_BOUNTY_AMOUNT = '500';
      process.env.MAX_BOUNTY_AMOUNT = '5';
      const config = getPublicConfig();
      expect(config.minBountyAmount).toBe(500);
      expect(config.maxBountyAmount).toBe(5);
    });
  });

  describe('defaultReservationTtlSeconds (RESERVATION_TTL_DAYS, in days)', () => {
    it.each([
      ['1', 86_400],
      ['0.5', 43_200], // fractional days allowed
      ['14', 1_209_600],
    ])('converts %s days -> %d seconds', (raw, expected) => {
      process.env.RESERVATION_TTL_DAYS = raw;
      expect(getPublicConfig().defaultReservationTtlSeconds).toBe(expected);
    });

    it.each(['0', '-1', 'abc', 'Infinity'])('falls back to 7 days for %s', (raw) => {
      process.env.RESERVATION_TTL_DAYS = raw;
      expect(getPublicConfig().defaultReservationTtlSeconds).toBe(604_800);
    });
  });

  describe('supportedTokens', () => {
    it('restricts to ALLOWED_TOKEN_SYMBOLS, trimming and upper-casing entries', () => {
      process.env.ALLOWED_TOKEN_SYMBOLS = ' xlm ,  ';
      expect(Object.keys(getPublicConfig().supportedTokens)).toEqual(['XLM']);
    });

    it('silently omits allowlisted symbols that have no known address', () => {
      process.env.ALLOWED_TOKEN_SYMBOLS = 'NOPE';
      expect(getPublicConfig().supportedTokens).toEqual({});
    });

    it('falls back to every known token when the allowlist has no non-empty entries', () => {
      process.env.ALLOWED_TOKEN_SYMBOLS = ' , ,';
      expect(Object.keys(getPublicConfig().supportedTokens)).toEqual(expect.arrayContaining(['XLM', 'USDC']));
    });

    it('includes tokens added via TOKEN_ADDRESS_MAP and TOKEN_ADDR_<SYMBOL>', () => {
      process.env.TOKEN_ADDRESS_MAP = JSON.stringify({ eurc: 'CEURC' });
      process.env.TOKEN_ADDR_BRL = 'CBRL';
      process.env.ALLOWED_TOKEN_SYMBOLS = 'EURC,BRL';
      expect(getPublicConfig().supportedTokens).toEqual({ EURC: 'CEURC', BRL: 'CBRL' });
    });

    it('does not throw on malformed TOKEN_ADDRESS_MAP JSON; warns and keeps built-in tokens', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.TOKEN_ADDRESS_MAP = '{not json';
      process.env.ALLOWED_TOKEN_SYMBOLS = 'XLM';
      expect(() => getPublicConfig()).not.toThrow();
      expect(Object.keys(getPublicConfig().supportedTokens)).toEqual(['XLM']);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('network resolution', () => {
    it.each([
      ['Public Global Stellar Network ; September 2015', 'mainnet'],
      ['Test SDF Network ; September 2015', 'testnet'],
      ['Test SDF Future Network ; October 2022', 'futurenet'],
    ])('maps passphrase %j -> %s', (passphrase, expected) => {
      process.env.SOROBAN_NETWORK_PASSPHRASE = passphrase;
      expect(getPublicConfig().network).toBe(expected);
    });

    it('a recognised passphrase wins over STELLAR_NETWORK', () => {
      process.env.SOROBAN_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
      process.env.STELLAR_NETWORK = 'testnet';
      expect(getPublicConfig().network).toBe('mainnet');
    });

    it('returns STELLAR_NETWORK verbatim (unvalidated) for an unrecognised passphrase', () => {
      process.env.SOROBAN_NETWORK_PASSPHRASE = 'some private network';
      process.env.STELLAR_NETWORK = 'my-custom-net';
      expect(getPublicConfig().network).toBe('my-custom-net');
    });

    it('defaults to futurenet when neither variable is set', () => {
      expect(getPublicConfig().network).toBe('futurenet');
    });
  });

  describe('call semantics', () => {
    it('re-reads process.env on every call (nothing is cached)', () => {
      process.env.PROTOCOL_FEE_BPS = '100';
      expect(getPublicConfig().feeBps).toBe(100);
      process.env.PROTOCOL_FEE_BPS = '200';
      expect(getPublicConfig().feeBps).toBe(200);
    });

    it('returns a fresh object (and supportedTokens map) each call', () => {
      const a = getPublicConfig();
      const b = getPublicConfig();
      expect(a).not.toBe(b);
      expect(a.supportedTokens).not.toBe(b.supportedTokens);
      a.supportedTokens.MUTATED = 'x';
      expect(getPublicConfig().supportedTokens).not.toHaveProperty('MUTATED');
    });
  });

  describe('error propagation', () => {
    it('propagates an error thrown by the token-address lookup (it is not swallowed)', () => {
      tokenMap.override = () => {
        throw new Error('token lookup exploded');
      };
      expect(() => getPublicConfig()).toThrow('token lookup exploded');
    });
  });
});
