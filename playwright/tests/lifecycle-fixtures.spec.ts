import { test, expect } from '@playwright/test';
import {
  LifecycleFixtureError,
  PUBLIC_NETWORK_PASSPHRASE,
  freighterDoubleConfig,
  installFreighterDouble,
  isValidStellarPublicKey,
  readFreighterSigningLog,
  resetFreighterDouble,
  resolveLifecycleFixtures,
  setFreighterRejectSigning,
  type LifecycleFixtures,
} from '../support/lifecycle-fixtures';
import { installLifecycleApiDouble } from '../support/lifecycle-api-double';

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

  test('wallet double supports deterministic rejection and recovery toggling (SBB-2026-482)', async ({
    page,
  }) => {
    await installFreighterDouble(page, validFixtures, { rejectSigning: true });
    await page.goto('about:blank');

    // Attempting to sign while rejection is enabled throws deterministic error
    const rejectionError = await page.evaluate(async () => {
      try {
        const freighter = (window as unknown as { freighter: { signMessage: (msg: string) => Promise<unknown> } }).freighter;
        await freighter.signMessage('test-payload');
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    });
    expect(rejectionError).toContain('rejected in Freighter');

    // Signing log remains empty on rejection
    expect(await readFreighterSigningLog(page)).toEqual([]);

    // Toggling rejection off enables recovery
    await setFreighterRejectSigning(page, false);
    const signResult = await page.evaluate(async () => {
      const freighter = (window as unknown as { freighter: { signMessage: (msg: string) => Promise<{ signature: string }> } }).freighter;
      return freighter.signMessage('test-payload');
    });
    expect(signResult.signature).toBe('e2e-wallet-signature-not-a-real-signature');
    expect(await readFreighterSigningLog(page)).toEqual(['test-payload']);

    // resetFreighterDouble clears the signing log and resets flags for rerun safety
    await resetFreighterDouble(page);
    expect(await readFreighterSigningLog(page)).toEqual([]);
  });
});

test.describe('bounty lifecycle API double rerun safety and recovery (SBB-2026-482)', () => {
  test('API double resets in-memory state cleanly for rerun safety', async ({ page }) => {
    const double = await installLifecycleApiDouble(page, validFixtures);
    await page.goto('about:blank');

    // Create a bounty through the double
    const res = await page.evaluate(async ({ apiUrl, maintainer }) => {
      const response = await fetch(`${apiUrl}/api/bounties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'ritik4ever/stellar-bounty-board',
          issueNumber: 999,
          title: 'Rerun safety test',
          amount: 10,
          maintainer,
        }),
      });
      return response.status;
    }, { apiUrl: validFixtures.apiUrl, maintainer: validFixtures.maintainer });
    expect(res).toBe(201);
    expect(double.bounties).toHaveLength(1);
    expect(double.requests).toHaveLength(1);

    // Reset double state
    double.reset();
    expect(double.bounties).toHaveLength(0);
    expect(double.requests).toHaveLength(0);
  });

  test('API double handles delayed confirmation and allows retry recovery', async ({ page }) => {
    const double = await installLifecycleApiDouble(page, validFixtures, {
      failReleaseCount: 1,
      releaseErrorMessage: 'Contract confirmation timeout',
    });
    await page.goto('about:blank');

    // Create, reserve, submit
    const bountyId = await page.evaluate(async ({ apiUrl, maintainer, contributor }) => {
      const createRes = await fetch(`${apiUrl}/api/bounties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'ritik4ever/stellar-bounty-board',
          issueNumber: 1001,
          title: 'Delayed confirmation test',
          amount: 25,
          maintainer,
        }),
      });
      const created = await createRes.json();
      const id = created.data.id;

      await fetch(`${apiUrl}/api/bounties/${id}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contributor }),
      });
      await fetch(`${apiUrl}/api/bounties/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contributor,
          submissionUrl: 'https://github.com/ritik4ever/stellar-bounty-board/pull/10',
        }),
      });
      return id;
    }, { apiUrl: validFixtures.apiUrl, maintainer: validFixtures.maintainer, contributor: validFixtures.contributor });

    expect(double.bounties[0]!.status).toBe('submitted');

    // First release attempt fails with 504 gateway timeout (delayed contract confirmation)
    const firstAttemptStatus = await page.evaluate(async ({ apiUrl, maintainer, bountyId }) => {
      const response = await fetch(`${apiUrl}/api/bounties/${bountyId}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stellar-public-key': maintainer,
          'x-stellar-signature': 'e2e-wallet-signature-not-a-real-signature',
        },
        body: JSON.stringify({
          maintainer,
          action: 'release',
          bountyId,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      });
      return response.status;
    }, { apiUrl: validFixtures.apiUrl, maintainer: validFixtures.maintainer, bountyId });
    expect(firstAttemptStatus).toBe(504);
    // Bounty status must remain submitted, not released
    expect(double.bounties[0]!.status).toBe('submitted');

    // Second release attempt recovers and succeeds
    const secondAttemptStatus = await page.evaluate(async ({ apiUrl, maintainer, bountyId }) => {
      const response = await fetch(`${apiUrl}/api/bounties/${bountyId}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stellar-public-key': maintainer,
          'x-stellar-signature': 'e2e-wallet-signature-not-a-real-signature',
        },
        body: JSON.stringify({
          maintainer,
          action: 'release',
          bountyId,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      });
      return response.status;
    }, { apiUrl: validFixtures.apiUrl, maintainer: validFixtures.maintainer, bountyId });
    expect(secondAttemptStatus).toBe(200);
    expect(double.bounties[0]!.status).toBe('released');
  });
});
