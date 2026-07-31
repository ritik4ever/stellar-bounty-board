/**
 * Public runtime configuration for the Stellar Bounty Board platform.
 *
 * Values here are sourced from environment variables so the frontend and
 * contract-interaction layer stay in sync without hardcoding anything.
 * ONLY non-sensitive, UI-facing values are exposed — never secrets, DB
 * connection strings, API keys, or internal service URLs.
 */

import { getTokenAddressMap, getAllowedTokenSymbols } from './utils';
import { getAllowedTokenSymbols as _getAllowedTokenSymbols } from './validation/schemas';

export interface PublicConfig {
  /**
   * Protocol fee in basis points (100 bps = 1 %).
   * Matches the `protocol_fee_bps` argument accepted by the Soroban contract's
   * `create_bounty` instruction.  0 = no protocol fee.
   */
  feeBps: number;

  /**
   * Minimum seconds that must elapse after a dispute is raised before an
   * arbiter can resolve it.  Mirrors the `dispute_window` set on the contract
   * during `initialize`.
   */
  disputeWindowSeconds: number;

  /**
   * Minimum bounty amount in the bounty token.
   * Enforced by `validateBountyAmount` in the API layer.
   */
  minBountyAmount: number;

  /**
   * Maximum bounty amount in the bounty token.
   * Enforced by `validateBountyAmount` in the API layer.
   */
  maxBountyAmount: number;

  /**
   * Token symbols that can be used when creating a bounty, together with
   * their resolved Soroban contract addresses.
   *
   * Example: { XLM: "CAS3J7...", USDC: "CCW677..." }
   */
  supportedTokens: Record<string, string>;

  /**
   * Default reservation TTL in seconds.  After this window a held reservation
   * is automatically returned to `open` by the expiration job.
   */
  defaultReservationTtlSeconds: number;

  /**
   * Soroban network the backend is connected to (e.g. "testnet", "futurenet",
   * "mainnet").  Derived from `SOROBAN_NETWORK_PASSPHRASE` when set; falls
   * back to "futurenet".
   */
  network: string;
}

/** Map a Soroban network passphrase to a human-readable label. */
function resolveNetworkLabel(): string {
  const passphrase = process.env.SOROBAN_NETWORK_PASSPHRASE ?? '';
  if (passphrase.includes('Public Global')) return 'mainnet';
  if (passphrase.includes('Test SDF Network')) return 'testnet';
  if (passphrase.includes('Test SDF Future Network')) return 'futurenet';
  return process.env.STELLAR_NETWORK ?? 'futurenet';
}

/**
 * Build the public config object from environment variables.
 *
 * Sensitive variables (GITHUB_WEBHOOK_SECRET, DATABASE_URL, ADMIN_API_KEY_HASH,
 * MAINTAINER_PUBLIC_KEY, SENDGRID_API_KEY, etc.) are never included.
 */
export function getPublicConfig(): PublicConfig {
  const feeBps = (() => {
    const raw = process.env.PROTOCOL_FEE_BPS;
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000 ? Math.floor(parsed) : 0;
  })();

  const disputeWindowSeconds = (() => {
    const raw = process.env.DISPUTE_WINDOW_SECONDS;
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  })();

  const minBountyAmount = (() => {
    const raw = process.env.MIN_BOUNTY_AMOUNT;
    if (!raw) return 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  })();

  const maxBountyAmount = (() => {
    const raw = process.env.MAX_BOUNTY_AMOUNT;
    if (!raw) return 10_000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
  })();

  const defaultReservationTtlSeconds = (() => {
    const raw = process.env.RESERVATION_TTL_DAYS;
    if (!raw) return 604_800; // 7 days
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 86_400) : 604_800;
  })();

  // Build the token map — only expose symbols that are in the allowlist.
  const allowedSymbols = (() => {
    const configured = process.env.ALLOWED_TOKEN_SYMBOLS?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (configured && configured.length > 0) return configured;
    return Object.keys(getTokenAddressMap());
  })();

  const fullMap = getTokenAddressMap();
  const supportedTokens: Record<string, string> = {};
  for (const symbol of allowedSymbols) {
    if (fullMap[symbol]) {
      supportedTokens[symbol] = fullMap[symbol];
    }
  }

  return {
    feeBps,
    disputeWindowSeconds,
    minBountyAmount,
    maxBountyAmount,
    supportedTokens,
    defaultReservationTtlSeconds,
    network: resolveNetworkLabel(),
  };
}
