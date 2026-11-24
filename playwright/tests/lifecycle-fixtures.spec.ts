import { test, expect } from '@playwright/test';
import {
  LifecycleFixtureError,
  PUBLIC_NETWORK_PASSPHRASE,
  freighterDoubleConfig,
  isValidStellarPublicKey,
  readFreighterSigningLog,
  resolveLifecycleFixtures,
  type LifecycleFixtures,
} from '../support/lifecycle-fixtures';

const validFixtures = resolveLifecycleFixtures({});

function fixtureError(run: () => unknown): LifecycleFixtureError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LifecycleFixtureError);
    return error as LifecycleFixtureError;
  }
  throw new Error('expected a LifecycleFixtureError');
}

test.describe('lifecycle fixture validation', () => {
  test('accepts the default testnet fixtures', () => {
    expect(validFixtures).toMatchObject({
      maintainer: 'GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK',
      contributor: 'GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF',
      network: 'TESTNET',
      baseUrl: 'http://localhost:3000',
      apiUrl: 'http://localhost:3001',
    });
    expect(Object.isFrozen(validFixtures)).toBe(true);
  });

  test('rejects a 55-character contributor that only looks like a G-address', () => {
    const error = fixtureError(() =>
      resolveLifecycleFixtures({
        E2E_CONTRIBUTOR_ADDRESS: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY',
      })
    );
    expect(error.code).toBe('invalid_identity');
    expect(error.field).toBe('E2E_CONTRIBUTOR_ADDRESS');
  });

  test('rejects an address with a corrupted StrKey checksum', () => {
    const corrupted = `${validFixtures.maintainer.slice(0, 55)}A`;
    const error = fixtureError(() =>
      resolveLifecycleFixtures({ E2E_MAINTAINER_ADDRESS: corrupted })
    );
    expect(error.code).toBe('invalid_identity');
    expect(error.field).toBe('E2E_MAINTAINER_ADDRESS');
  });

  test('rejects the same account for maintainer and contributor', () => {
    const error = fixtureError(() =>
      resolveLifecycleFixtures({ E2E_CONTRIBUTOR_ADDRESS: validFixtures.maintainer })
    );
    expect(error.code).toBe('duplicate_identity');
    expect(error.field).toBe('E2E_CONTRIBUTOR_ADDRESS');
  });

  test('rejects the mainnet passphrase', () => {
    const error = fixtureError(() =>
      resolveLifecycleFixtures({ VITE_STELLAR_NETWORK_PASSPHRASE: PUBLIC_NETWORK_PASSPHRASE })
    );
    expect(error.code).toBe('unsafe_environment');
    expect(error.field).toBe('VITE_STELLAR_NETWORK_PASSPHRASE');
  });

  test('rejects any network other than TESTNET', () => {
    const error = fixtureError(() =>
      resolveLifecycleFixtures({ VITE_STELLAR_NETWORK: 'FUTURENET' })
    );
    expect(error.code).toBe('invalid_network');
    expect(error.field).toBe('VITE_STELLAR_NETWORK');
  });

  test('rejects remote endpoints that are not explicit test doubles', () => {
    const error = fixtureError(() =>
      resolveLifecycleFixtures({ BASE_URL: 'https://horizon.stellar.org' })
    );
    expect(error.code).toBe('unsafe_environment');
    expect(error.field).toBe('BASE_URL');
  });

  test('rejects URLs with embedded credentials', () => {
    const error = fixtureError(() =>
      resolveLifecycleFixtures({ API_URL: 'http://operator:secret@127.0.0.1:3001' })
    );
    expect(error.code).toBe('unsafe_environment');
    expect(error.field).toBe('API_URL');
  });

  test('allows an explicitly listed CI service host', () => {
    const fixtures = resolveLifecycleFixtures({
      BASE_URL: 'http://frontend:3000',
      API_URL: 'http://backend:3001',
      E2E_ALLOWED_HOSTS: 'frontend, backend',
    });
    expect(fixtures.baseUrl).toBe('http://frontend:3000');
    expect(fixtures.apiUrl).toBe('http://backend:3001');
  });

  test('validates Stellar StrKeys including the checksum', () => {
    expect(isValidStellarPublicKey(validFixtures.maintainer)).toBe(true);
    expect(isValidStellarPublicKey(validFixtures.contributor)).toBe(true);
    expect(isValidStellarPublicKey('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY')).toBe(
      false
    );
    expect(
      isValidStellarPublicKey('SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    ).toBe(false);
    expect(isValidStellarPublicKey(undefined)).toBe(false);
  });
});

test.describe('wallet double authorization', () => {
  test('refuses a wallet that does not hold the maintainer fixture key', () => {
    const error = fixtureError(() =>
      freighterDoubleConfig(validFixtures, { publicKey: validFixtures.contributor })
    );
    expect(error.code).toBe('wallet_mismatch');
  });

  test('refuses a malformed wallet key', () => {
    const error = fixtureError(() =>
      freighterDoubleConfig(validFixtures, { publicKey: 'GNOTAKEY' })
    );
    expect(error.code).toBe('invalid_identity');
  });

  test('refuses non-testnet fixtures before the wallet can be installed or asked to sign', async ({
    page,
  }) => {
    const publicFixtures = {
      ...validFixtures,
      network: 'PUBLIC',
      networkPassphrase: PUBLIC_NETWORK_PASSPHRASE,
    } as unknown as LifecycleFixtures;

    expect(() => freighterDoubleConfig(publicFixtures)).toThrowError(LifecycleFixtureError);

    // Nothing reached the browser: no wallet surface and no signing attempts.
    expect(
      await page.evaluate(() => Boolean((window as unknown as { freighter?: unknown }).freighter))
    ).toBe(false);
    expect(await readFreighterSigningLog(page)).toEqual([]);
  });
});
