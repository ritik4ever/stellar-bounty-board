import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../logger';
import '../types/express-request';

// Configuration interface for the middleware
export interface IpReputationAntiSpamConfig {
  enforceMode: boolean;
  spamWindowSeconds: number;
  ipCheckEnabled: boolean;
  maxInMemoryEntries: number;
}

// Result from IP reputation check
export interface IpReputationResult {
  isFlagged: boolean;
  reason?: string;
  source: 'local_blocklist' | 'api' | 'none';
}

// Result from spam detection
export interface SpamDetectionResult {
  isSpam: boolean;
  matchedTitle?: string;
  matchedDescription?: string;
}

// Represents a recent request stored for spam detection
export interface RecentRequest {
  ip: string;
  title: string;
  description: string;
  timestamp: number;
}

// Interface for IP reputation checking service
export interface IpReputationChecker {
  /**
   * Check if an IP address has a bad reputation
   * @param ip - The IP address to check
   * @returns Promise<IpReputationResult>
   */
  checkIp(ip: string): Promise<IpReputationResult>;
}

// Interface for anti-spam detection service
export interface AntiSpamDetector {
  /**
   * Check if a request matches spam heuristics
   */
  checkSpam(
    ip: string,
    title: string,
    description: string
  ): SpamDetectionResult;

  /**
   * Record a request for future spam detection
   */
  recordRequest(
    ip: string,
    title: string,
    description: string
  ): void;

  /**
   * Clean up expired entries
   */
  cleanup(): void;
}

export const DEFAULT_CONFIG: IpReputationAntiSpamConfig = {
  enforceMode: false,
  spamWindowSeconds: 60,
  ipCheckEnabled: true,
  maxInMemoryEntries: 10_000,
};

/**
 * Resolve the runtime configuration, applying caller overrides on top of the
 * defaults. Environment variables are read lazily so tests can mutate
 * `process.env` between calls.
 */
function resolveConfig(
  overrides?: Partial<IpReputationAntiSpamConfig>
): IpReputationAntiSpamConfig {
  const envEnforce = process.env.IP_REPUTATION_ENFORCE;
  const envWindow = process.env.IP_REPUTATION_SPAM_WINDOW_SECONDS;
  const envIpCheck = process.env.IP_REPUTATION_IP_CHECK_ENABLED;
  const envMaxEntries = process.env.IP_REPUTATION_MAX_ENTRIES;

  const fromEnv: Partial<IpReputationAntiSpamConfig> = {};
  if (envEnforce !== undefined) {
    fromEnv.enforceMode = parseBoolean(envEnforce, false);
  }
  if (envWindow !== undefined && envWindow !== '') {
    fromEnv.spamWindowSeconds = parsePositiveInt(
      envWindow,
      DEFAULT_CONFIG.spamWindowSeconds
    );
  }
  if (envIpCheck !== undefined) {
    fromEnv.ipCheckEnabled = parseBoolean(envIpCheck, true);
  }
  if (envMaxEntries !== undefined && envMaxEntries !== '') {
    fromEnv.maxInMemoryEntries = parsePositiveInt(
      envMaxEntries,
      DEFAULT_CONFIG.maxInMemoryEntries
    );
  }

  return {
    ...DEFAULT_CONFIG,
    ...fromEnv,
    ...overrides,
  };
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function parsePositiveInt(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

/**
 * Determine the client IP for a request. Honours the `X-Forwarded-For` header
 * (first hop) when set so the check works behind the existing nginx proxy, but
 * falls back to `req.ip` (which itself respects Express' `trust proxy` setting).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
}

/**
 * Default IP reputation checker backed by a local blocklist/allowlist that an
 * operator configures via `IP_REPUTATION_BLOCKLIST` and
 * `IP_REPUTATION_ALLOWLIST` (comma-separated IPs / CIDRs). The allowlist takes
 * precedence so an operator can exempt trusted infrastructure even if a
 * broader CIDR is blocked. The lookup is synchronous but exposed as a promise
 * to honour the {@link IpReputationChecker} contract for future API-backed
 * implementations.
 */
export function createLocalBlocklistIpChecker(): IpReputationChecker {
  function parseList(envVar: string): string[] {
    const raw = process.env[envVar];
    if (!raw) return [];
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  function matches(ip: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern === ip) return true;
      const cidrMatch = pattern.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
      if (cidrMatch) {
        if (ipInCidr(ip, cidrMatch[1], Number(cidrMatch[2]))) return true;
      }
    }
    return false;
  }

  return {
    async checkIp(ip: string): Promise<IpReputationResult> {
      const allow = parseList('IP_REPUTATION_ALLOWLIST');
      if (matches(ip, allow)) {
        return { isFlagged: false, source: 'local_blocklist' };
      }
      const block = parseList('IP_REPUTATION_BLOCKLIST');
      if (matches(ip, block)) {
        return {
          isFlagged: true,
          source: 'local_blocklist',
          reason: 'ip_matches_local_blocklist',
        };
      }
      return { isFlagged: false, source: 'none' };
    },
  };
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) + n;
  }
  return result >>> 0;
}

function ipInCidr(ip: string, base: string, prefix: number): boolean {
  if (prefix < 0 || prefix > 32) return false;
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Default in-memory anti-spam detector. Stores recent `(ip, title, summary)`
 * tuples in a sliding window and flags a new request as spam when an identical
 * title or summary has already been recorded from the same IP within the
 * configured window. The store is bounded by `maxInMemoryEntries` to avoid
 * unbounded growth, evicting the oldest entries first.
 */
export function createInMemoryAntiSpamDetector(
  windowSeconds: number,
  maxEntries: number
): AntiSpamDetector {
  const store = new Map<string, RecentRequest>();

  function fingerprint(ip: string, title: string, description: string): string {
    return `${ip}|${normalize(title)}|${normalize(description)}`;
  }

  function normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  return {
    checkSpam(ip, title, description): SpamDetectionResult {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const target = normalize(title);
      const targetDesc = normalize(description);

      for (const entry of store.values()) {
        if (now - entry.timestamp > windowMs) continue;
        if (entry.ip !== ip) continue;

        if (target && normalize(entry.title) === target) {
          return {
            isSpam: true,
            matchedTitle: entry.title,
          };
        }
        if (
          targetDesc &&
          targetDesc.length >= 20 &&
          normalize(entry.description) === targetDesc
        ) {
          return {
            isSpam: true,
            matchedDescription: entry.description,
          };
        }
      }
      return { isSpam: false };
    },

    recordRequest(ip, title, description): void {
      const key = fingerprint(ip, title, description);
      // Enforce the bound by removing the oldest entry before inserting.
      while (store.size >= maxEntries) {
        const oldestKey = store.keys().next().value;
        if (oldestKey === undefined) break;
        store.delete(oldestKey);
      }
      store.set(key, {
        ip,
        title,
        description,
        timestamp: Date.now(),
      });
    },

    cleanup(): void {
      const cutoff = Date.now() - windowSeconds * 1000;
      for (const [key, entry] of store) {
        if (entry.timestamp < cutoff) {
          store.delete(key);
        }
      }
    },
  };
}

/**
 * Extract the title and free-text description from a create-bounty request
 * body. The bounty schema uses `title` and `summary`; both are surfaced here so
 * the heuristic can run without coupling the middleware to a specific schema.
 */
function extractTitleAndDescription(req: Request): {
  title: string;
  description: string;
} {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title : '';
  const summary = typeof body.summary === 'string' ? body.summary : '';
  const description =
    typeof body.description === 'string' ? body.description : summary;
  return { title, description };
}

const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Create the IP reputation and anti-spam middleware.
 *
 * Behaviour:
 *  - When `enforceMode` is `false` (default, "log-only"), flagged requests are
 *    logged distinctly and allowed through so they can be reviewed manually.
 *  - When `enforceMode` is `true` ("enforce"), flagged requests are rejected
 *    with `403 Forbidden`.
 *
 * The flagged log line is emitted at `warn` level and tagged with
 * `flag: "ip_reputation_anti_spam"` so it can be filtered apart from normal
 * traffic in any log aggregator.
 *
 * @param config - Optional configuration overrides (merged with env vars)
 * @param deps   - Optional dependency injection for tests
 */
export function createIpReputationAntiSpamMiddleware(
  config?: Partial<IpReputationAntiSpamConfig>,
  deps?: {
    ipChecker?: IpReputationChecker;
    spamDetector?: AntiSpamDetector;
  }
): RequestHandler {
  const resolved = resolveConfig(config);
  const ipChecker = deps?.ipChecker ?? createLocalBlocklistIpChecker();
  const spamDetector =
    deps?.spamDetector ??
    createInMemoryAntiSpamDetector(
      resolved.spamWindowSeconds,
      resolved.maxInMemoryEntries
    );

  const cleanupTimer = setInterval(() => {
    spamDetector.cleanup();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    const ip = getClientIp(req);
    const { title, description } = extractTitleAndDescription(req);

    let ipResult: IpReputationResult = { isFlagged: false, source: 'none' };
    if (resolved.ipCheckEnabled) {
      try {
        ipResult = await ipChecker.checkIp(ip);
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            ip,
          },
          'ip_reputation_check_failed'
        );
      }
    }

    const spamResult = spamDetector.checkSpam(ip, title, description);

    const flagged = ipResult.isFlagged || spamResult.isSpam;

    if (flagged) {
      const logPayload = {
        flag: 'ip_reputation_anti_spam',
        ip,
        requestId: req.requestId,
        ipReputation: ipResult,
        spam: spamResult,
        enforceMode: resolved.enforceMode,
        path: req.path,
      };

      logger.warn(logPayload, 'flagged_bounty_creation');

      if (resolved.enforceMode) {
        const reason =
          ipResult.reason ??
          (spamResult.isSpam ? 'spam_heuristic_matched' : 'flagged');
        res.status(403).json({
          error: 'Request flagged by IP reputation / anti-spam checks.',
          reason,
          requestId: req.requestId,
        });
        return;
      }
    }

    spamDetector.recordRequest(ip, title, description);
    next();
  };
}

/**
 * Reset helpers exposed for the test suite so each case can start from a
 * pristine state when reusing the default in-memory detector.
 */
export function __resetInMemoryAntiSpamDetector(
  detector: AntiSpamDetector
): void {
  detector.cleanup();
}
