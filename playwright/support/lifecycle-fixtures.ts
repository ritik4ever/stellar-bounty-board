/**
 * Validated fixtures for the bounty lifecycle E2E suite (#1952).
 *
 * The lifecycle spec moves real value: it reserves work, attaches a signature,
 * and releases escrow. Every identity, network and endpoint involved in that
 * flow is therefore an input that must be checked *before* the browser is
 * opened or the wallet double can sign anything.
 *
 * `resolveLifecycleFixtures()` is a pure function so the rules are unit
 * testable and fail fast: an invalid address, a duplicate identity, a mainnet
 * passphrase or a non-loopback endpoint throws a `LifecycleFixtureError` while
 * the spec is still loading. `installFreighterDouble()` re-checks the wallet
 * identity before injecting the mock, so a mismatched signer can never produce
 * a signature for a release the fixtures did not authorize.
 */

import type { Page } from '@playwright/test';

export const TESTNET_NETWORK = 'TESTNET';
export const TESTNET_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

/**
 * Deterministic signature returned by the wallet double. It is not a real
 * Ed25519 signature and is only ever compared against itself by the in-memory
 * API double; no chain or funded account is involved.
 */
export const E2E_WALLET_SIGNATURE = 'e2e-wallet-signature-not-a-real-signature';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const LIFECYCLE_FIXTURE_DEFAULTS = Object.freeze({
  maintainer: 'GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK',
  contributor: 'GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF',
  baseUrl: 'http://localhost:3000',
  apiUrl: 'http://localhost:3001',
});

export type LifecycleFixtureErrorCode =
  | 'invalid_identity'
  | 'duplicate_identity'
  | 'invalid_network'
  | 'unsafe_environment'
  | 'invalid_url'
  | 'wallet_mismatch';

export class LifecycleFixtureError extends Error {
  readonly code: LifecycleFixtureErrorCode;
  readonly field: string;

  constructor(code: LifecycleFixtureErrorCode, field: string, message: string) {
    super(`${code}: ${field}: ${message}`);
    this.name = 'LifecycleFixtureError';
    this.code = code;
    this.field = field;
  }
}

export interface LifecycleFixtures {
  readonly maintainer: string;
  readonly contributor: string;
  readonly network: typeof TESTNET_NETWORK;
  readonly networkPassphrase: typeof TESTNET_NETWORK_PASSPHRASE;
  readonly baseUrl: string;
  readonly apiUrl: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ED25519_PUBLIC_KEY_VERSION = 6 << 3;

function base32Decode(input: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`invalid base32 character: ${char}`);
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new Error('non-zero base32 padding');
  }

  return Uint8Array.from(bytes);
}

/** CRC-16/XMODEM (poly 0x1021, init 0x0000), as used by Stellar StrKey. */
function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * Checks a Stellar Ed25519 public key (StrKey) including its CRC-16 checksum.
 * A 56-character string that merely *looks* like a G-address is rejected.
 */
export function isValidStellarPublicKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^G[A-Z2-7]{55}$/.test(value)) {
    return false;
  }

  try {
    const decoded = base32Decode(value);
    if (decoded.length !== 35 || decoded[0] !== ED25519_PUBLIC_KEY_VERSION) {
      return false;
    }
    const expected = crc16Xmodem(decoded.subarray(0, 33));
    return decoded[33] === (expected & 0xff) && decoded[34] === expected >>> 8;
  } catch {
    return false;
  }
}

function resolveIdentity(value: string | undefined, fallback: string, field: string): string {
  const identity = (value ?? fallback).trim();
  if (!isValidStellarPublicKey(identity)) {
    throw new LifecycleFixtureError(
      'invalid_identity',
      field,
      `expected a Stellar Ed25519 public key (G + 55 base32 chars with a valid checksum); got ${JSON.stringify(identity)}`
    );
  }
  return identity;
}

function resolveAllowedHosts(env: Record<string, string | undefined>): Set<string> {
  const configured = (env.E2E_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOOPBACK_HOSTS, ...configured]);
}

function resolveUrl(raw: string, field: 'BASE_URL' | 'API_URL', allowedHosts: Set<string>): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LifecycleFixtureError(
      'invalid_url',
      field,
      `not an absolute URL: ${JSON.stringify(raw)}`
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LifecycleFixtureError('invalid_url', field, `unsupported protocol ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new LifecycleFixtureError(
      'unsafe_environment',
      field,
      'URL must not embed credentials; the suite only talks to local test doubles'
    );
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new LifecycleFixtureError(
      'unsafe_environment',
      field,
      `host ${url.hostname} is not a loopback test double; set E2E_ALLOWED_HOSTS to opt in explicitly`
    );
  }

  return url.toString().replace(/\/$/, '');
}

export interface LifecycleFixtureOptions {
  /** Extra hosts that are safe to use, e.g. a CI service name such as `frontend`. */
  allowedHosts?: string[];
}

/**
 * Resolves and validates every input the lifecycle suite depends on.
 *
 * Reads:
 *  - `E2E_MAINTAINER_ADDRESS` / `E2E_CONTRIBUTOR_ADDRESS` (identity)
 *  - `VITE_STELLAR_NETWORK` / `VITE_STELLAR_NETWORK_PASSPHRASE` (network)
 *  - `BASE_URL` / `API_URL` (test-double endpoints)
 *  - `E2E_ALLOWED_HOSTS` (optional extra host allowlist)
 *
 * Throws `LifecycleFixtureError` for anything that could move real funds,
 * reach mainnet, or sign as the wrong account.
 */
export function resolveLifecycleFixtures(
  env: Record<string, string | undefined> = process.env,
  options: LifecycleFixtureOptions = {}
): LifecycleFixtures {
  const network = (env.VITE_STELLAR_NETWORK ?? TESTNET_NETWORK).trim().toUpperCase();
  if (network !== TESTNET_NETWORK) {
    throw new LifecycleFixtureError(
      'invalid_network',
      'VITE_STELLAR_NETWORK',
      `lifecycle tests only run against testnet doubles; got ${JSON.stringify(network)}`
    );
  }

  const networkPassphrase = (
    env.VITE_STELLAR_NETWORK_PASSPHRASE ?? TESTNET_NETWORK_PASSPHRASE
  ).trim();
  if (networkPassphrase === PUBLIC_NETWORK_PASSPHRASE) {
    throw new LifecycleFixtureError(
      'unsafe_environment',
      'VITE_STELLAR_NETWORK_PASSPHRASE',
      'mainnet passphrase is not allowed; the suite must never touch the public network'
    );
  }
  if (networkPassphrase !== TESTNET_NETWORK_PASSPHRASE) {
    throw new LifecycleFixtureError(
      'invalid_network',
      'VITE_STELLAR_NETWORK_PASSPHRASE',
      `expected ${JSON.stringify(TESTNET_NETWORK_PASSPHRASE)}; got ${JSON.stringify(networkPassphrase)}`
    );
  }

  const maintainer = resolveIdentity(
    env.E2E_MAINTAINER_ADDRESS,
    LIFECYCLE_FIXTURE_DEFAULTS.maintainer,
    'E2E_MAINTAINER_ADDRESS'
  );
  const contributor = resolveIdentity(
    env.E2E_CONTRIBUTOR_ADDRESS,
    LIFECYCLE_FIXTURE_DEFAULTS.contributor,
    'E2E_CONTRIBUTOR_ADDRESS'
  );

  if (maintainer === contributor) {
    throw new LifecycleFixtureError(
      'duplicate_identity',
      'E2E_CONTRIBUTOR_ADDRESS',
      'maintainer and contributor must be different accounts so lifecycle transitions are attributable'
    );
  }

  const allowedHosts = new Set(resolveAllowedHosts(env));
  for (const host of options.allowedHosts ?? []) {
    allowedHosts.add(host.trim().toLowerCase());
  }

  return Object.freeze({
    maintainer,
    contributor,
    network: TESTNET_NETWORK,
    networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
    baseUrl: resolveUrl(
      env.BASE_URL ?? LIFECYCLE_FIXTURE_DEFAULTS.baseUrl,
      'BASE_URL',
      allowedHosts
    ),
    apiUrl: resolveUrl(env.API_URL ?? LIFECYCLE_FIXTURE_DEFAULTS.apiUrl, 'API_URL', allowedHosts),
  });
}

export interface FreighterDoubleConfig {
  readonly publicKey: string;
  readonly network: typeof TESTNET_NETWORK;
  readonly networkPassphrase: typeof TESTNET_NETWORK_PASSPHRASE;
  readonly signature: string;
}

/**
 * Builds (and validates) the wallet double configuration.
 *
 * The wallet key must equal the validated maintainer identity: release
 * authorization is checked against that account, so a mismatched wallet would
 * sign a request the suite did not intend. This throws before any init script
 * is installed, which is what guarantees invalid setup fails before signing.
 */
export function freighterDoubleConfig(
  fixtures: LifecycleFixtures,
  options: { publicKey?: string } = {}
): FreighterDoubleConfig {
  if (
    fixtures.network !== TESTNET_NETWORK ||
    fixtures.networkPassphrase !== TESTNET_NETWORK_PASSPHRASE
  ) {
    throw new LifecycleFixtureError(
      'invalid_network',
      'wallet',
      'wallet double must be configured for the Stellar testnet passphrase'
    );
  }

  const publicKey = (options.publicKey ?? fixtures.maintainer).trim();
  if (!isValidStellarPublicKey(publicKey)) {
    throw new LifecycleFixtureError(
      'invalid_identity',
      'wallet',
      `wallet public key is not a valid Stellar Ed25519 public key: ${JSON.stringify(publicKey)}`
    );
  }
  if (publicKey !== fixtures.maintainer) {
    throw new LifecycleFixtureError(
      'wallet_mismatch',
      'wallet',
      'wallet must hold the maintainer fixture key that is allowed to release the escrow'
    );
  }

  return Object.freeze({
    publicKey,
    network: TESTNET_NETWORK,
    networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
    signature: E2E_WALLET_SIGNATURE,
  });
}

export interface InstallFreighterDoubleOptions {
  readonly publicKey?: string;
  readonly rejectSigning?: boolean;
}

/**
 * Injects a connected, testnet-only Freighter double whose signatures are
 * deterministic and never leave the browser. Validation happens here first, so
 * an invalid identity/network aborts before `window.freighter` exists.
 *
 * Supports deterministic wallet rejection and rerun safety (SBB-2026-482).
 */
export async function installFreighterDouble(
  page: Page,
  fixtures: LifecycleFixtures,
  options: InstallFreighterDoubleOptions = {}
): Promise<FreighterDoubleConfig> {
  const config = freighterDoubleConfig(fixtures, { publicKey: options.publicKey });

  await page.addInitScript(
    ({ publicKey, networkPassphrase, signature, initialReject }) => {
      const signedPayloads: string[] = [];
      let rejectSigning = initialReject;

      (
        window as unknown as {
          __stellarE2E: {
            signedPayloads: string[];
            setRejectSigning: (reject: boolean) => void;
            reset: () => void;
          };
        }
      ).__stellarE2E = {
        signedPayloads,
        setRejectSigning: (reject: boolean) => {
          rejectSigning = reject;
        },
        reset: () => {
          signedPayloads.length = 0;
          rejectSigning = false;
        },
      };

      (window as unknown as { freighter: Record<string, unknown> }).freighter = {
        isConnected: async () => ({ isConnected: true }),
        getPublicKey: async () => publicKey,
        getNetwork: async () => ({ network: 'TESTNET', networkPassphrase }),
        setNetwork: async () => {},
        signMessage: async (message: string) => {
          if (rejectSigning) {
            throw new Error('User declined transaction / rejected in Freighter');
          }
          signedPayloads.push(message);
          return { signature };
        },
      };
    },
    { ...config, initialReject: options.rejectSigning ?? false }
  );

  return config;
}

/** Toggles whether the wallet double rejects future signing requests (SBB-2026-482). */
export async function setFreighterRejectSigning(page: Page, reject: boolean): Promise<void> {
  await page.evaluate((r) => {
    const scope = window as unknown as {
      __stellarE2E?: { setRejectSigning?: (reject: boolean) => void };
    };
    scope.__stellarE2E?.setRejectSigning?.(r);
  }, reject);
}

/** Resets the wallet double signing log and flags for rerun safety (SBB-2026-482). */
export async function resetFreighterDouble(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as {
      __stellarE2E?: { reset?: () => void };
    };
    scope.__stellarE2E?.reset?.();
  });
}

/** Reads the payloads the wallet double has been asked to sign. */
export async function readFreighterSigningLog(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scope = window as unknown as { __stellarE2E?: { signedPayloads: string[] } };
    return scope.__stellarE2E?.signedPayloads ?? [];
  });
}
