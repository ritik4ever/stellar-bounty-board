import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import swaggerUi from 'swagger-ui-express';
import pinoHttp from 'pino-http';
import { z } from 'zod';

import { generateOpenApiDocument } from './docs/openapi';
import { getMetrics, httpRequestDuration } from './metrics';
import { buildCorsOptions } from './middleware/corsOptions';
import { runDeepHealthCheck } from './services/deepHealth';

import {
  createBounty,
  disputeBounty,
  extendDeadline,
  resolveDisputeBounty,
  updateBountyNotes,
  listBountyAuditLogs,
  listAllAuditLogs,
  listBounties,
  listBountiesCached,
  invalidateBountyCache,
  refundBounty,
  cancelBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
  getBountyEvents,
  getMaintainerMetrics,
  getGlobalMetrics,
  getGlobalMetricsCached,
  getLeaderboard,
  aggregatedMetrics,
} from './services/bountyStore';

import { listOpenIssues } from './services/openIssues';
import {
  registerPushSubscription,
  unregisterPushSubscription,
} from './services/pushSubscriptionService';
import {
  setNotificationOptIn,
  getNotificationOptIn,
  isNotificationOptedIn,
  NOTIFICATION_LIFECYCLE_TRANSITIONS,
} from './services/notificationService';

import {
  bountyIdSchema,
  createBountySchema,
  disputeBountySchema,
  extendDeadlineSchema,
  resolveDisputeBountySchema,
  maintainerActionSchema,
  bulkActionSchema,
  reserveBountyRequestSchema,
  submitBountySchema,
  updateNotesSchema,
  healthInputSchema,
  listBountiesInputSchema,
  listBountiesQuerySchema,
  zodErrorMessage,
} from './validation/schemas';
import { validateBody } from './middleware/validateBody';
import { getPublicConfig } from './config';
import { getAppConfig } from './appConfig';

import {
  captureRawBody,
  createGitHubWebhookSignatureMiddleware,
} from './webhooks/signatureVerification';
import {
  createBountyCreationSignatureMiddleware,
  createStellarSignatureAuthMiddleware,
} from './middleware/auth';
import { idempotencyMiddleware } from './middleware/idempotency';
import { IdempotencyKeyReuseError, runIdempotent } from './idempotency';
import { requireJsonContentType } from './middleware/contentType';
import { enforceBodyLimit, DEFAULT_BODY_LIMIT } from './middleware/bodyLimit';
import { maintainerLimiter } from './middleware/maintainerLimiter';
import { logger } from './logger';
import rateLimit from 'express-rate-limit';
import { createAdminApiKeyAuthMiddleware } from './middleware/adminAuth';
import {
  createTerminalErrorHandler,
  MiddlewareDependencyError,
  INTERNAL_ERROR_MESSAGE,
} from './middleware/errors';
import { ServiceDependencyError, wrapServiceError } from './services/errors';
import { handleGitHubPrEvent } from './webhooks/githubPrHandler';
import { draining } from './shutdown';
import { applyBountyTemplate, listBountyTemplates } from './services/bountyTemplates';
import { csvRowToBounty, parseBountyCsv } from './services/csvImport';
import {
  cancelRecurringSchedule,
  createRecurringSchedule,
  listRecurringSchedules,
  type ScheduleCadence,
} from './services/recurringBountySchedules';
import { createGraphQLRouter } from './graphql';

const INCOMING_REQUEST_ID = /^[a-zA-Z0-9-]{1,128}$/;

export function resolveRequestId(req: Request): string {
  const raw = req.headers['x-request-id'];

  if (typeof raw === 'string') {
    const trimmed = raw.trim();

    if (INCOMING_REQUEST_ID.test(trimmed)) {
      return trimmed;
    }
  }

  return randomUUID();
}

function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.id as string;
  res.setHeader('X-Request-ID', req.requestId);

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs) / 1e6;
    const durationSec = durationMs / 1000;

    httpRequestDuration.observe(
      {
        method: req.method,
        route: req.route?.path || req.path,
        status_code: res.statusCode,
      },
      durationSec
    );
  });

  next();
}

export const app = express();
const appConfig = getAppConfig();

// Per-IP rate limiting (Wave 4 #81, #1298)
const readLimiter = rateLimit({
  windowMs: appConfig.rateLimitWindowMs,
  max: appConfig.rateLimitReadMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many read requests, please slow down.' },
  skip: (req: Request) =>
    (process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true') ||
    Boolean(
      req.path &&
      (req.path === '/api/open-issues' ||
        req.path.endsWith('/open-issues') ||
        req.path === '/api/bounties' ||
        req.path === '/api/bounties/' ||
        req.path === '/api/health/deep')
    ),
});

const mutationLimiter = rateLimit({
  windowMs: appConfig.rateLimitWindowMs,
  max: appConfig.rateLimitMutationMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many mutations, please slow down.' },
  skip: (req: Request) =>
    (process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true') ||
    Boolean(
      req.path &&
      (req.path.endsWith('/release') ||
        req.path.endsWith('/submit') ||
        req.path.endsWith('/refund') ||
        req.path === '/api/bounties' ||
        req.path === '/api/bounties/')
    ),
});

/**
 * Route-specific explicit rate limiter for POST /api/bounties/:id/release (#1209).
 *
 * Cost justification:
 * Releasing a bounty is a high-cost, critical financial operation that:
 * 1. Cryptographically verifies maintainer Ed25519 signatures and public key authorization.
 * 2. Interacts with the Stellar blockchain / Soroban RPC to release or verify escrow disbursement.
 * 3. Modifies persistent state ('submitted' -> 'released'), writes audit records, and invalidates caches.
 * 4. Triggers asynchronous push notifications and lifecycle transition webhooks.
 *
 * Maintainers execute releases intentionally after milestone or pull request review approval;
 * legitimate callers do not invoke this endpoint in high-frequency bursts. An explicit ceiling
 * of 10 requests per minute (configurable via RATE_LIMIT_RELEASE_MAX and RATE_LIMIT_RELEASE_WINDOW_MS)
 * prevents transaction spam, mitigates replay attacks, and protects downstream RPC infrastructure.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const releaseLimiter = rateLimit({
  windowMs: appConfig.rateLimitReleaseWindowMs,
  max: appConfig.rateLimitReleaseMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitReleaseWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many bounty release attempts. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

/**
 * Route-specific explicit rate limiter for POST /api/bounties/:id/submit (#1205).
 *
 * Cost justification:
 * Submitting a bounty is a moderately expensive, unauthenticated operation that:
 * 1. Performs an outbound GitHub API call to validate the submission URL against the
 *    source repository and issue (validateGithubPrUrlForRepo) — every request consumes
 *    third-party quota and is a potential amplification/abuse target since no
 *    authentication is required.
 * 2. Acquires the global store lock and rewrites persistent bounty state
 *    ('reserved' -> 'submitted'), appends audit logs, and invalidates the bounty cache.
 * 3. Triggers asynchronous maintainer notifications for the submitted bounty.
 *
 * A contributor submits intentionally once per reserved bounty; legitimate callers do not
 * invoke this endpoint in high-frequency bursts. An explicit ceiling of 10 requests per
 * minute (configurable via RATE_LIMIT_SUBMIT_MAX and RATE_LIMIT_SUBMIT_WINDOW_MS) prevents
 * GitHub API quota exhaustion from unauthenticated traffic and protects store persistence
 * from write spam.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const submitLimiter = rateLimit({
  windowMs: appConfig.rateLimitSubmitWindowMs,
  max: appConfig.rateLimitSubmitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitSubmitWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many bounty submission attempts. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

/**
 * Route-specific explicit rate limiter for POST /api/bounties/:id/reserve (#1201).
 *
 * Cost justification:
 * Reserving a bounty is a state-changing, unauthenticated write that:
 * 1. Acquires the global store lock, serializing it against every other writer, and
 *    rewrites the persistent JSON store on each call.
 * 2. Transitions bounty state ('open' -> 'reserved'), bumps the optimistic-concurrency
 *    version, and appends an immutable audit-log entry.
 * 3. Invalidates the platform-wide bounty cache and dispatches a maintainer notification.
 *
 * A contributor reserves a bounty at most once before submitting work; legitimate callers
 * do not invoke this endpoint in high-frequency bursts. An explicit ceiling of 10 requests
 * per minute (configurable via RATE_LIMIT_RESERVE_MAX and RATE_LIMIT_RESERVE_WINDOW_MS)
 * matches the sibling unauthenticated write routes (submit/release/refund) and protects the
 * store lock, persistence layer, and notification fan-out from write spam.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const reserveLimiter = rateLimit({
  windowMs: appConfig.rateLimitReserveWindowMs,
  max: appConfig.rateLimitReserveMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitReserveWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many bounty reservation attempts. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

/**
 * Route-specific explicit rate limiter for POST /api/bounties/:id/refund (#1213).
 *
 * Cost justification:
 * Refunding a bounty is a high-cost escrow reversal operation that:
 * 1. Cryptographically validates maintainer authorization and Ed25519 signatures.
 * 2. Verifies deadline expiration, dispute resolution status, and cancellation rules.
 * 3. Triggers on-chain Stellar Soroban smart contract refund interactions to return locked escrow tokens.
 * 4. Modifies persistent state ('open'/'disputed' -> 'refunded'), records immutable audit log entries,
 *    and invalidates platform-wide cached bounty lists and financial metrics.
 * 5. Dispatches notifications and event webhooks informing participants of the refund.
 *
 * Legitimate maintainers initiate refunds infrequently (only when bounties expire unclaimed or
 * dispute resolutions dictate returning funds). An explicit ceiling of 10 requests per minute
 * (configurable via RATE_LIMIT_REFUND_MAX and RATE_LIMIT_REFUND_WINDOW_MS) protects the route
 * against automated transaction flooding, abuse, and RPC queue saturation.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const refundLimiter = rateLimit({
  windowMs: appConfig.rateLimitRefundWindowMs,
  max: appConfig.rateLimitRefundMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitRefundWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many bounty refund attempts. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

/**
 * Route-specific explicit rate limiter for POST /api/bounties (bounty creation).
 *
 * Cost justification:
 * Creating a bounty is an expensive, unauthenticated write operation that:
 * 1. Executes maintainer rate limiting (`maintainerLimiter`) using filesystem locks and JSON persistence.
 * 2. Cryptographically verifies Ed25519 signatures when maintainer signature headers are supplied.
 * 3. Applies bounty templates, executes Zod schema validation, and validates financial amounts.
 * 4. Acquires the exclusive global filesystem store lock (`withStoreLock`), parses the store,
 *    assigns IDs, resolves token contract addresses, and writes out the updated JSON store to disk.
 * 5. Invalidates the bounty cache across all cached listing queries.
 * 6. Dispatches asynchronous notification events to maintainers and interested parties.
 *
 * Legitimate maintainers create bounties deliberately as new tasks are defined; it is never
 * intended for high-frequency burst traffic. An explicit ceiling of 10 requests per minute
 * (configurable via RATE_LIMIT_CREATE_MAX and RATE_LIMIT_CREATE_WINDOW_MS) protects the
 * file-backed store lock from contention, avoids write spam, prevents cache thrashing, and
 * shields against denial-of-service on an unauthenticated write endpoint.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const createBountyLimiter = rateLimit({
  windowMs: appConfig.rateLimitCreateWindowMs,
  max: appConfig.rateLimitCreateMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitCreateWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many bounty creation attempts. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

export const createLimiter = createBountyLimiter;

/**
 * Route-specific explicit rate limiter for GET /api/open-issues (#1222).
 *
 * Cost justification:
 * Fetching open candidate issues is a public, unauthenticated read operation that:
 * 1. Queries upstream third-party GitHub REST API (/repos/:owner/:repo/issues) on cache misses.
 * 2. Consumes GitHub API rate limits (60 req/hr unauthenticated, 5,000 req/hr authenticated).
 *    Excessive requests from unauthenticated clients could exhaust GitHub API quotas for the entire
 *    platform, causing downstream service degradation (HTTP 502/403).
 * 3. While responses are cached for 10 minutes (openIssuesCacheSeconds), an attacker or aggressive crawler
 *    hitting expired entries or requesting with distinct cache headers can cause repeated upstream fetch spikes.
 * 4. Legitimate frontend clients fetch this list during discovery or board browsing; normal users do not
 *    need more than a few requests per minute.
 *
 * An explicit ceiling of 30 requests per minute (configurable via RATE_LIMIT_OPEN_ISSUES_MAX and
 * RATE_LIMIT_OPEN_ISSUES_WINDOW_MS) protects upstream API quotas and backend memory while providing
 * more than ample capacity for legitimate browsing.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const openIssuesLimiter = rateLimit({
  windowMs: appConfig.rateLimitOpenIssuesWindowMs,
  max: appConfig.rateLimitOpenIssuesMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitOpenIssuesWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many requests for open issues. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

/**
 * Route-specific explicit rate limiter for GET /api/bounties (#1220).
 *
 * Cost justification:
 * Fetching the bounties list is an unauthenticated, public read endpoint with moderate-to-high cost:
 * 1. Executes multi-parameter query filtering (q, repo, status, tokenSymbol, contributor, maintainer,
 *    minReward, maxReward, deadlineBefore, deadlineAfter) and sorting across all bounties in the store.
 * 2. Employs caching (`listBountiesCached`) backed by an in-memory or Redis layer, and generates/validates
 *    conditional HTTP headers (ETag, Last-Modified, If-None-Match).
 * 3. On cache misses or high-cardinality filter permutations (custom text search / query variants),
 *    each request forces an in-memory scan, array slicing, and JSON serialization of potentially large
 *    bounty payloads.
 * 4. While legitimate clients (frontend index and search pages) query this endpoint when users browse or
 *    filter bounties, excessive unauthenticated bursts could exhaust backend CPU and memory.
 *
 * An explicit ceiling of 60 requests per minute (configurable via RATE_LIMIT_BOUNTIES_MAX and
 * RATE_LIMIT_BOUNTIES_WINDOW_MS) balances responsive browsing for human users with protection
 * against automated scraping, denial of service, and resource exhaustion.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const bountiesLimiter = rateLimit({
  windowMs: appConfig.rateLimitBountiesWindowMs,
  max: appConfig.rateLimitBountiesMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitBountiesWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many requests for bounties. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

/**
 * Route-specific explicit rate limiter for GET /api/health (#1180).
 *
 * Cost justification:
 * Fetching the health status is a cheap, unauthenticated liveness probe that performs
 * essentially no work:
 * 1. No store lock, no GitHub/Stellar/Soroban call, no disk or database I/O.
 * 2. It only validates the (empty) query/body via `healthInputSchema` and returns a
 *    static `{ status: 'ok', timestamp }` payload.
 *
 * Because it is a liveness probe it is polled by load balancers, Kubernetes
 * readiness/liveness checks, and uptime monitors, often from a small number of shared
 * IPs. Legitimate traffic therefore needs a much higher ceiling than ordinary reads to
 * avoid falsely signalling an outage. An explicit ceiling of 300 requests per minute
 * (5 req/sec per IP, configurable via RATE_LIMIT_HEALTH_MAX and RATE_LIMIT_HEALTH_WINDOW_MS)
 * is far above any realistic monitor cadence while still bounding unauthenticated flooding.
 *
 * Note: per-IP limiting can misbehave when many clients sit behind a single NAT/proxy;
 * very high-volume probes are better exempted at the infrastructure layer than handled here.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const healthLimiter = rateLimit({
  windowMs: appConfig.rateLimitHealthWindowMs,
  max: appConfig.rateLimitHealthMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitHealthWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many health check requests. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

/**
 * Route-specific explicit rate limiter for GET /api/health/deep (#1184).
 *
 * Cost justification:
 * Each check probes the filesystem by creating, reading, and deleting a temporary file,
 * and sends an outbound Soroban RPC request that can wait up to the configured component
 * timeout. A ceiling of 10 requests per minute per IP allows a probe every six seconds
 * while bounding unauthenticated disk and RPC work. Operators can tune it with
 * RATE_LIMIT_DEEP_HEALTH_MAX and RATE_LIMIT_DEEP_HEALTH_WINDOW_MS.
 *
 * When the limit is exceeded, HTTP 429 is returned with an explicit Retry-After header.
 */
export const deepHealthLimiter = rateLimit({
  windowMs: appConfig.rateLimitDeepHealthWindowMs,
  max: appConfig.rateLimitDeepHealthMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST_MODE !== 'true',
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(appConfig.rateLimitDeepHealthWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many deep health check requests. Please try again later.',
      retryAfter,
      requestId: req.requestId,
    });
  },
});

// Apply read limiter to all GET requests
app.use((req: any, res: any, next: any) => {
  if (req.method === 'GET') return readLimiter(req, res, next);
  next();
});

// Apply mutation limiter to POST/PUT/PATCH/DELETE
app.use((req: any, res: any, next: any) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method))
    return mutationLimiter(req, res, next);
  next();
});

app.use(cors(buildCorsOptions()));

app.use(
  express.json({
    verify: captureRawBody,
    limit: appConfig.rawBodyLimit,
  })
);

app.use(
  pinoHttp({
    logger: logger as any,
    genReqId: (req) => resolveRequestId(req),
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req) => {
        const url = req.url ?? '';
        return url === '/api/health' || url === '/api/health/deep' || url === '/worker/health';
      },
    },
  })
);
app.use(requestContextMiddleware);

const healthHandler = (req: Request, res: Response) => {
  const result = healthInputSchema.safeParse({
    params: req.params,
    query: req.query,
    body: req.body,
  });

  if (!result.success) {
    res.status(400).json({
      error: 'Invalid input for health endpoint.',
      code: 'HEALTH_INVALID_INPUT',
      details: result.error.issues,
      requestId: req.requestId,
    });
    return;
  }

  res.json({
    service: 'stellar-bounty-board-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};

app.get('/api/health', healthLimiter, idempotencyMiddleware, healthHandler);

/**
 * Validates every input to `GET /api/health/deep` before any dependency probe
 * (store, Soroban RPC, contract, auth) runs.
 *
 * The route accepts no path parameters, no query string, and no request body.
 * `healthInputSchema` enforces that contract explicitly, so unexpected input is
 * rejected here with HTTP 400 and the `HEALTH_DEEP_INVALID_INPUT` error code
 * rather than surfacing as a confusing downstream failure.
 */
app.get(
  '/api/health/deep',
  deepHealthLimiter,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    const result = healthInputSchema.safeParse({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    if (!result.success) {
      res.status(400).json({
        error: 'Invalid input for deep health endpoint.',
        code: 'HEALTH_DEEP_INVALID_INPUT',
        details: result.error.issues,
        requestId: req.requestId,
      });
      return;
    }

    const health = await runDeepHealthCheck();
    const statusCode = health.overall === 'up' ? 200 : 503;
    res.status(statusCode).json(health);
  }
);

app.get('/worker/health', (_req: Request, res: Response) => {
  res.json({
    service: 'stellar-bounty-board-worker',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use(readLimiter);

const swaggerDoc = generateOpenApiDocument();
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
app.use('/graphql', createGraphQLRouter());

function parseId(raw: string | string[] | undefined): string {
  return bountyIdSchema.parse(Array.isArray(raw) ? raw[0] : raw);
}

export function parsePaginationValue(
  raw: unknown,
  field: string,
  defaultValue: number,
  min: number,
  max?: number
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value !== 'string') {
    throw new Error(`${field} must be an integer.`);
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be an integer.`);
  }

  if (parsed < min) {
    throw new Error(`${field} must be greater than or equal to ${min}.`);
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`${field} must be less than or equal to ${max}.`);
  }

  return parsed;
}

export function jsonError(res: Response, req: Request, statusCode: number, message: string): void {
  res.status(statusCode).json({ error: message, requestId: req.requestId });
}

export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const raw = String(value);

  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

const RAW_LEAK_PATTERNS = [
  /ENOENT/i,
  /EACCES/i,
  /EPERM/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /ELOCKED/i,
  /fetch failed/i,
  /SQLITE_/i,
  /PG::/i,
  /node:/i,
  /\bat\b.*\(.*:\d+:\d+\)/,
  /[A-Z]:\\[^ \n\r\t]+/i,
  /\/home\/[^ \n\r\t]+/i,
  /\/var\/[^ \n\r\t]+/i,
  /\/usr\/[^ \n\r\t]+/i,
  /\/etc\/[^ \n\r\t]+/i,
];

function containsRawLeak(message: string): boolean {
  return RAW_LEAK_PATTERNS.some((pattern) => pattern.test(message));
}

export function sendError(res: Response, req: Request, error: unknown, statusCode = 400): void {
  const log = req.log ?? logger;
  const requestId = req.requestId;

  if (error instanceof ServiceDependencyError) {
    log.error(
      {
        err: error.cause,
        operation: error.operation,
        dependency: error.dependency,
        statusCode: error.statusCode,
        requestId,
      },
      'service_dependency_failure'
    );
    jsonError(res, req, error.statusCode, error.publicMessage);
    return;
  }

  if (error instanceof MiddlewareDependencyError) {
    log.error(
      {
        err: error.cause,
        operation: error.operation,
        dependency: error.dependency,
        statusCode: error.statusCode,
        requestId,
      },
      'middleware_dependency_failure'
    );
    jsonError(res, req, error.statusCode, error.publicMessage);
    return;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);

  if (statusCode >= 500 || containsRawLeak(rawMessage)) {
    log.error(
      {
        err: error,
        rawMessage,
        statusCode: statusCode >= 500 ? statusCode : 500,
        requestId,
      },
      'unhandled_route_dependency_failure'
    );
    jsonError(res, req, statusCode >= 500 ? statusCode : 500, INTERNAL_ERROR_MESSAGE);
    return;
  }

  jsonError(res, req, statusCode, rawMessage);
}

export function validateBountyAmount(amount: number): string | null {
  if (!Number.isFinite(amount)) {
    return 'Amount must be a valid number.';
  }

  if (amount < 1) {
    return 'Amount must be at least 1 XLM';
  }

  if (amount > 10000) {
    return 'Amount cannot exceed 10000 XLM';
  }

  const decimalPart = amount.toString().split('.')[1];

  if (decimalPart && decimalPart.length > 7) {
    return 'Amount must have at most 7 decimal places';
  }

  return null;
}

app.get('/robots.txt', (_req: Request, res: Response) => {
  const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://stellar-bounty-board.vercel.app';

  res
    .type('text/plain')
    .send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin/',
        '',
        `Sitemap: ${FRONTEND_URL}/sitemap.xml`,
      ].join('\n')
    );
});

app.get('/sitemap.xml', (_req: Request, res: Response) => {
  const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://stellar-bounty-board.vercel.app';
  const allBounties = listBounties();
  const indexable = allBounties.filter(
    (bounty) => bounty.status === 'open' || bounty.status === 'released'
  );

  const urlset = indexable
    .map((bounty) => {
      const lastmod = bounty.releasedAt ?? bounty.createdAt ?? Date.now();

      return [
        '  <url>',
        `    <loc>${FRONTEND_URL}/bounties/${bounty.id}</loc>`,
        `    <lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlset,
    '</urlset>',
  ].join('\n');

  res.type('application/xml').send(xml);
});

app.get('/api/bounties/by-issue', (req: Request, res: Response) => {
  const repo = req.query.repo;
  const issueStr = req.query.issue;

  if (!repo || !issueStr) {
    return res.status(400).json({ error: 'Missing required query parameters: repo and issue' });
  }

  if (typeof repo !== 'string' || typeof issueStr !== 'string') {
    return res.status(400).json({ error: 'Invalid query parameter types' });
  }

  const issueNumber = parseInt(issueStr, 10);
  if (isNaN(issueNumber)) {
    return res.status(400).json({ error: 'Issue parameter must be a valid number' });
  }

  const bounties = listBounties();
  const found = bounties.find(
    (b) => b.repo.toLowerCase() === repo.toLowerCase() && b.issueNumber === issueNumber
  );

  if (!found) {
    return res.status(404).json({
      error: `Bounty not found for repository ${repo} and issue #${issueNumber}`,
    });
  }

  return res.json({ data: found });
});

app.get('/api/bounties/search', (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const page = parsePaginationValue(req.query.page, 'page', 1, 1);
    const pageSize =
      req.query.limit !== undefined
        ? parsePaginationValue(req.query.limit, 'limit', 20, 1, 100)
        : parsePaginationValue(req.query.pageSize, 'pageSize', 20, 1, 100);
    const repo =
      typeof req.query.repo === 'string' && req.query.repo.trim()
        ? req.query.repo.trim()
        : undefined;
    const minReward = req.query.minReward === undefined ? undefined : Number(req.query.minReward);
    const maxReward = req.query.maxReward === undefined ? undefined : Number(req.query.maxReward);

    if (minReward !== undefined && (!Number.isFinite(minReward) || minReward < 0)) {
      throw new Error('minReward must be a non-negative number.');
    }
    if (maxReward !== undefined && (!Number.isFinite(maxReward) || maxReward < 0)) {
      throw new Error('maxReward must be a non-negative number.');
    }
    if (minReward !== undefined && maxReward !== undefined && minReward > maxReward) {
      throw new Error('minReward must not exceed maxReward.');
    }
    if (!query) {
      res.json({ data: [], total: 0, page, pageSize, hasMore: false });
      return;
    }

    const ranked = listBounties()
      .map((bounty) => {
        const title = bounty.title.toLowerCase();
        const summary = bounty.summary.toLowerCase();
        const repo = bounty.repo.toLowerCase();
        const score = title.includes(query)
          ? 3
          : repo.includes(query)
            ? 2
            : summary.includes(query)
              ? 1
              : 0;
        return { bounty, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.bounty.createdAt - a.bounty.createdAt)
      .map(({ bounty }) => bounty);
    const total = ranked.length;
    const start = (page - 1) * pageSize;
    const data = ranked.slice(start, start + pageSize);
    res.setHeader('X-Total-Count', String(total));
    res.json({ data, total, page, pageSize, hasMore: start + data.length < total });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get('/api/bounty-templates', (_req: Request, res: Response) => {
  res.json({ data: listBountyTemplates() });
});

const adminAuth = createAdminApiKeyAuthMiddleware();

app.post(
  '/api/bounties/import',
  mutationLimiter,
  adminAuth,
  express.text({ type: ['text/csv', 'application/csv'], limit: appConfig.csvUploadLimit }),
  async (req: Request, res: Response) => {
    if (typeof req.body !== 'string') {
      jsonError(res, req, 415, 'Content-Type must be text/csv or application/csv.');
      return;
    }
    try {
      const rows = parseBountyCsv(req.body);
      const results: Array<{ row: number; id?: string; errors?: string[] }> = [];
      for (let index = 0; index < rows.length; index += 1) {
        const csvError = rows[index].__csvError;
        if (csvError) {
          results.push({ row: index + 2, errors: [csvError] });
          continue;
        }
        const candidate = applyBountyTemplate(csvRowToBounty(rows[index]));
        const parsed = createBountySchema.safeParse(candidate);
        if (!parsed.success) {
          results.push({
            row: index + 2,
            errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
          });
          continue;
        }
        const amountError = validateBountyAmount(parsed.data.amount);
        if (amountError) {
          results.push({ row: index + 2, errors: [amountError] });
          continue;
        }
        try {
          const bounty = await createBounty(parsed.data);
          results.push({ row: index + 2, id: bounty.id });
        } catch (error) {
          results.push({
            row: index + 2,
            errors: [error instanceof Error ? error.message : 'Unexpected error'],
          });
        }
      }
      const created = results.filter((result) => result.id).length;
      res
        .status(201)
        .json({ data: results, created, failed: results.length - created, total: results.length });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

const recurringScheduleSchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  templateId: z.string().trim().min(1),
  targetRepo: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  bounty: z.record(z.unknown()),
  startAt: z.number().int().positive().optional(),
});

app.get('/api/recurring-bounty-schedules', adminAuth, (_req: Request, res: Response) => {
  res.json({ data: listRecurringSchedules() });
});

app.post(
  '/api/recurring-bounty-schedules',
  mutationLimiter,
  requireJsonContentType,
  adminAuth,
  async (req: Request, res: Response) => {
    try {
      const request = recurringScheduleSchema.parse(req.body);
      const merged = createBountySchema.parse(
        applyBountyTemplate({
          templateId: request.templateId,
          ...request.bounty,
          repo: request.targetRepo,
        })
      );
      const { repo: _repo, ...bounty } = merged;
      const schedule = createRecurringSchedule({
        cadence: request.cadence as ScheduleCadence,
        templateId: request.templateId,
        targetRepo: request.targetRepo,
        bounty,
        startAt: request.startAt,
      });
      res.status(201).json({ data: schedule });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.delete(
  '/api/recurring-bounty-schedules/:id',
  mutationLimiter,
  adminAuth,
  (req: Request, res: Response) => {
    try {
      res.json({ data: cancelRecurringSchedule(parseId(req.params.id)) });
    } catch (error) {
      sendError(
        res,
        req,
        error,
        error instanceof Error && error.message.includes('not found') ? 404 : 400
      );
    }
  }
);

/**
 * Validates every input to `GET /api/bounties` before the idempotency cache,
 * store, or contract layer is touched. Path parameters must be empty, the
 * query string is checked against {@link listBountiesQuerySchema}, and a
 * request body is rejected. On failure the route returns HTTP 400 with the
 * `BOUNTIES_INVALID_INPUT` error code and the individual Zod issues.
 */
const validateListBountiesInput = (req: Request, res: Response, next: NextFunction): void => {
  const parsed = listBountiesInputSchema.safeParse({
    params: req.params,
    query: req.query,
    body: req.body,
  });

  if (!parsed.success) {
    res.status(400).json({
      error: `INVALID_INPUT: ${zodErrorMessage(parsed.error)}`,
      code: 'BOUNTIES_INVALID_INPUT',
      details: parsed.error.issues,
      requestId: req.requestId,
    });
    return;
  }

  res.locals.bountiesQuery = parsed.data.query;
  next();
};

app.get(
  '/api/bounties',
  bountiesLimiter,
  validateListBountiesInput,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const query = res.locals.bountiesQuery as z.infer<typeof listBountiesQuerySchema>;
      const page = query.page;
      // `limit` is the primary page-size param; `pageSize` is a legacy alias.
      const pageSize = query.limit ?? query.pageSize ?? 20;

      const all = await listBountiesCached({
        q: query.q,
        repo: query.repo,
        minReward: query.minReward,
        maxReward: query.maxReward,
        contributor: query.contributor,
        maintainer: query.maintainer,
        status: query.status,
        tokenSymbol: query.tokenSymbol,
        deadlineBefore: query.deadlineBefore,
        deadlineAfter: query.deadlineAfter,
        sort: query.sort,
        order: query.order,
      });
      const total = all.length;
      const start = (page - 1) * pageSize;
      const data = all.slice(start, start + pageSize);
      const hasMore = start + data.length < total;

      let maxTimestamp = 0;
      for (const bounty of all) {
        if (bounty.events && bounty.events.length > 0) {
          const lastEvent = bounty.events[bounty.events.length - 1];
          if (lastEvent.timestamp > maxTimestamp) {
            maxTimestamp = lastEvent.timestamp;
          }
        } else if (bounty.createdAt > maxTimestamp) {
          maxTimestamp = bounty.createdAt;
        }
      }

      if (maxTimestamp > 0) {
        const lastModifiedDate = new Date(maxTimestamp * 1000);
        res.setHeader('Last-Modified', lastModifiedDate.toUTCString());
      }

      const responsePayload = { data, total, page, pageSize, hasMore };
      const responseString = JSON.stringify(responsePayload);
      const etag = `"${createHash('md5').update(responseString).digest('hex')}"`;
      res.setHeader('ETag', etag);

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      res.setHeader('X-Total-Count', String(total));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json(responsePayload);
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.get('/api/leaderboard', (req: Request, res: Response) => {
  try {
    const limit = parsePaginationValue(req.query.limit, 'limit', 10, 1, 100);
    const leaderboard = getLeaderboard(limit);
    res.json({ data: leaderboard });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get('/api/bounties/:id/audit-logs', (req: Request, res: Response) => {
  try {
    const limit = parsePaginationValue(req.query.limit, 'limit', 20, 1, 100);
    const offset = parsePaginationValue(req.query.offset, 'offset', 0, 0);
    const page = listBountyAuditLogs(parseId(req.params.id), { limit, offset });

    res.json(page);
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get('/api/bounties/:id/audit-log', (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const pageNumber = parsePaginationValue(req.query.page, 'page', 1, 1);
    const pageSize = parsePaginationValue(req.query.pageSize, 'pageSize', 20, 1, 100);
    const bounties = listBounties();
    const bountyExists = bounties.some((item) => item.id === id);

    if (!bountyExists) {
      jsonError(res, req, 404, 'Bounty not found.');
      return;
    }

    const offset = (pageNumber - 1) * pageSize;
    const page = listBountyAuditLogs(id, { limit: pageSize, offset });

    res.json({
      data: page.data,
      total: page.pagination.total,
      page: pageNumber,
      pageSize,
    });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get('/api/bounties/released/export.csv', (req: Request, res: Response) => {
  try {
    const { repo, contributor, asset, issueNumber } = req.query;

    let released = listBounties().filter((bounty) => bounty.status === 'released');

    if (typeof repo === 'string' && repo.trim()) {
      const expected = repo.trim().toLowerCase();
      released = released.filter((bounty) => bounty.repo.toLowerCase() === expected);
    }

    if (typeof contributor === 'string' && contributor.trim()) {
      const expected = contributor.trim();
      released = released.filter((bounty) => bounty.contributor === expected);
    }

    if (typeof asset === 'string' && asset.trim()) {
      const expected = asset.trim().toUpperCase();
      released = released.filter((bounty) => bounty.tokenSymbol.toUpperCase() === expected);
    }

    if (typeof issueNumber === 'string' && issueNumber.trim()) {
      const parsed = Number(issueNumber);

      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        jsonError(res, req, 400, 'issueNumber must be a positive integer.');
        return;
      }

      released = released.filter((bounty) => bounty.issueNumber === parsed);
    }

    const header = ['repo', 'issue_number', 'contributor', 'asset', 'amount', 'released_at'].join(
      ','
    );

    const rows = released
      .sort((a, b) => (b.releasedAt ?? 0) - (a.releasedAt ?? 0))
      .map((bounty) => {
        const releasedAtIso = bounty.releasedAt
          ? new Date(bounty.releasedAt * 1000).toISOString()
          : '';

        return [
          escapeCsv(bounty.repo),
          escapeCsv(bounty.issueNumber),
          escapeCsv(bounty.contributor ?? ''),
          escapeCsv(bounty.tokenSymbol),
          escapeCsv(bounty.amount),
          escapeCsv(releasedAtIso),
        ].join(',');
      });

    const csv = [header, ...rows].join('\n');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="released-payouts-${timestamp}.csv"`
    );
    res.status(200).send(`${csv}\n`);
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post(
  '/api/bounties',
  createBountyLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  requireJsonContentType,
  idempotencyMiddleware,
  maintainerLimiter,
  createBountyCreationSignatureMiddleware(),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = applyBountyTemplate(req.body);
      next();
    } catch (error) {
      sendError(res, req, error);
    }
  },
  validateBody(createBountySchema),
  async (req: Request, res: Response) => {
    const amountError = validateBountyAmount(req.body.amount);

    if (amountError) {
      jsonError(res, req, 400, amountError);
      return;
    }

    try {
      const bounty = await createBounty(req.body);
      res.status(201).json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.post(
  '/api/bounties/:id/reserve',
  reserveLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  requireJsonContentType,
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = reserveBountyRequestSchema.safeParse({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    if (!parsed.success) {
      res.status(400).json({
        error: `INVALID_INPUT: ${zodErrorMessage(parsed.error)}`,
        code: 'BOUNTY_RESERVE_INVALID_INPUT',
        details: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }

    req.params.id = parsed.data.params.id;
    req.body = parsed.data.body;
    next();
  },
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      const execute = async () => ({
        status: 200,
        body: { data: await reserveBounty(id, req.body.contributor, req.body.expectedVersion) },
      });

      const rawKey = req.headers['idempotency-key'];
      const key = (Array.isArray(rawKey) ? rawKey[0] : rawKey)?.trim();

      if (!key) {
        const { status, body } = await execute();
        res.status(status).json(body);
        return;
      }

      // Scope the key to this route and bounty so it cannot collide with other endpoints.
      const { result, replayed } = await runIdempotent(
        `reserve:${id}:${key}`,
        JSON.stringify([req.body.contributor, req.body.expectedVersion ?? null]),
        execute
      );

      if (replayed) {
        res.setHeader('Idempotent-Replayed', 'true');
      }
      res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof IdempotencyKeyReuseError) {
        jsonError(res, req, 422, 'Idempotency-Key was already used with a different request');
        return;
      }
      sendError(res, req, error);
    }
  }
);

app.post(
  '/api/bounties/:id/submit',
  submitLimiter,
  requireJsonContentType,
  idempotencyMiddleware,
  validateBody(submitBountySchema),
  async (req: Request, res: Response) => {
    try {
      const bounty = await submitBounty(
        parseId(req.params.id),
        req.body.contributor,
        req.body.submissionUrl,
        req.body.notes
      );

      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

/**
 * Zod schema for POST /api/bounties/:id/release.
 *
 * Validates every input the route accepts before the store or contract layer
 * is touched: the `:id` path param, the (empty) query string, and the JSON
 * body carrying the maintainer address and optional transaction hash.
 */
const releaseBountyParamsSchema = z.object({ id: bountyIdSchema }).strict();
const releaseBountyQuerySchema = z.object({}).strict();
const releaseBountyBodySchema = maintainerActionSchema;

const releaseBountyRequestSchema = z.object({
  params: releaseBountyParamsSchema,
  query: releaseBountyQuerySchema,
  body: releaseBountyBodySchema,
});

app.post(
  '/api/bounties/:id/release',
  releaseLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  requireJsonContentType,
  idempotencyMiddleware,
  createStellarSignatureAuthMiddleware(),
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = releaseBountyRequestSchema.safeParse({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    if (!parsed.success) {
      jsonError(res, req, 400, `INVALID_INPUT: ${zodErrorMessage(parsed.error)}`);
      return;
    }

    req.body = parsed.data.body;
    next();
  },
  async (req: Request, res: Response) => {
    try {
      const bounty = await releaseBounty(
        req.params.id,
        req.body.maintainer,
        req.body.transactionHash
      );

      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.post(
  '/api/bounties/:id/refund',
  refundLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  idempotencyMiddleware,
  createStellarSignatureAuthMiddleware(),
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = refundBountyRequestSchema.safeParse({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    if (!parsed.success) {
      res.status(400).json({
        error: `INVALID_INPUT: ${zodErrorMessage(parsed.error)}`,
        code: 'BOUNTY_REFUND_INVALID_INPUT',
        details: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }

    req.params.id = parsed.data.params.id;
    req.body = parsed.data.body;
    next();
  },
  async (req: Request, res: Response) => {
    try {
      const bounty = await refundBounty(
        parseId(req.params.id),
        req.body.maintainer,
        req.body.transactionHash
      );
      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

/**
 * POST /api/bounties/bulk-action  (#829)
 *
 * Admin-only endpoint that applies a single maintainer transition
 * (`release` or `refund`) to a list of bounty IDs in one request.
 *
 * Each bounty is processed independently: a failure on one item (unknown ID,
 * wrong maintainer, already finalized, invalid status, ...) is recorded per
 * item and does NOT abort the remaining items. The response always contains a
 * per-item `results` array so callers can surface partial success/failure.
 *
 * Requires the admin API key (`x-admin-api-key` header) just like the
 * audit-log endpoint; the admin key replaces the per-item Stellar signature
 * required by the single-bounty endpoints.
 */
app.post(
  '/api/bounties/bulk-action',
  mutationLimiter,
  requireJsonContentType,
  createAdminApiKeyAuthMiddleware(),
  validateBody(bulkActionSchema),
  async (req: Request, res: Response) => {
    const { action, bountyIds, maintainer, transactionHash } = req.body as {
      action: 'release' | 'refund';
      bountyIds: string[];
      maintainer: string;
      transactionHash?: string;
    };

    const results: Array<{
      bountyId: string;
      success: boolean;
      status?: string;
      error?: string;
    }> = [];

    for (const bountyId of bountyIds) {
      try {
        const bounty =
          action === 'release'
            ? await releaseBounty(bountyId, maintainer, transactionHash)
            : await refundBounty(bountyId, maintainer, transactionHash);

        results.push({ bountyId, success: true, status: bounty.status });
      } catch (error) {
        results.push({
          bountyId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error.',
        });
      }
    }

    const succeeded = results.filter((result) => result.success).length;

    res.json({
      data: {
        action,
        results,
        succeeded,
        failed: results.length - succeeded,
      },
    });
  }
);

app.post(
  '/api/bounties/:id/cancel',
  mutationLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  idempotencyMiddleware,
  createStellarSignatureAuthMiddleware(),
  async (req: Request, res: Response) => {
    const parsedBody = maintainerActionSchema.safeParse(req.body);

    if (!parsedBody.success) {
      jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
      return;
    }

    try {
      const bounty = await cancelBounty(
        parseId(req.params.id),
        parsedBody.data.maintainer,
        parsedBody.data.transactionHash
      );

      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.post(
  '/api/bounties/:id/dispute',
  mutationLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  createStellarSignatureAuthMiddleware(),
  validateBody(disputeBountySchema),
  async (req: Request, res: Response) => {
    try {
      const bounty = await disputeBounty(
        parseId(req.params.id),
        req.body.contributor,
        req.body.reason
      );

      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.post(
  '/api/bounties/:id/resolve-dispute',
  mutationLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  validateBody(resolveDisputeBountySchema),
  async (req: Request, res: Response) => {
    try {
      const bounty = await resolveDisputeBounty(
        parseId(req.params.id),
        req.body.arbiter,
        req.body.release,
        req.body.transactionHash
      );

      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.patch(
  '/api/bounties/:id/notes',
  mutationLimiter,
  requireJsonContentType,
  createStellarSignatureAuthMiddleware(),
  validateBody(updateNotesSchema),
  async (req: Request, res: Response) => {
    try {
      const bounty = await updateBountyNotes(
        parseId(req.params.id),
        req.body.maintainer,
        req.body.notes
      );

      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.post(
  '/api/bounties/:id/extend-deadline',
  mutationLimiter,
  enforceBodyLimit(DEFAULT_BODY_LIMIT),
  idempotencyMiddleware,
  createStellarSignatureAuthMiddleware(),
  async (req: Request, res: Response) => {
    const parsedBody = extendDeadlineSchema.safeParse(req.body);

    if (!parsedBody.success) {
      jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
      return;
    }

    try {
      const bounty = await extendDeadline(
        parseId(req.params.id),
        parsedBody.data.maintainer,
        parsedBody.data.newDeadline
      );

      res.json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.post(
  '/api/webhooks/github',
  createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET),
  async (req: Request, res: Response) => {
    const rawDeliveryId = req.headers['x-github-delivery'];
    const deliveryId = Array.isArray(rawDeliveryId) ? rawDeliveryId[0] : rawDeliveryId;

    let result: { duplicate: boolean };
    try {
      result = await handleGitHubPrEvent(req.body, deliveryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook processing error';

      res.status(500).json({ error: message, requestId: req.requestId });
      return;
    }

    if (result.duplicate) {
      // Already processed this delivery ID — acknowledge without re-running side-effects
      res.status(200).json({
        data: {
          authenticated: true,
          provider: 'github',
          received: true,
          duplicate: true,
        },
      });
      return;
    }

    res.status(202).json({
      data: {
        authenticated: true,
        provider: 'github',
        received: true,
      },
    });
  }
);

/**
 * Zod schema for GET /api/open-issues.
 *
 * This route accepts no query parameters, path params, or request body.
 * The schema enforces that contract explicitly so that any unrecognised
 * input is rejected with a 400 before the service / GitHub API is touched.
 */
const openIssuesQuerySchema = z.object({}).strict();

app.get(
  '/api/open-issues',
  openIssuesLimiter,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    // Validate query params — must be empty; any unknown key is a 400.
    const queryResult = openIssuesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      jsonError(res, req, 400, `INVALID_QUERY: ${zodErrorMessage(queryResult.error)}`);
      return;
    }

    // Reject any accidental request body.
    if (req.body && Object.keys(req.body).length > 0) {
      jsonError(
        res,
        req,
        400,
        'INVALID_BODY: GET /api/open-issues does not accept a request body.'
      );
      return;
    }

    try {
      const data = await listOpenIssues();
      res.set('Cache-Control', `max-age=${appConfig.openIssuesCacheSeconds}`);
      res.json({ data });
    } catch (error) {
      sendError(res, req, error, 502);
    }
  }
);

app.get('/api/bounties/:id/events', (req: Request, res: Response) => {
  try {
    const events = getBountyEvents(parseId(req.params.id));
    res.json({ data: events });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get('/api/bounties/:id', (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const bounties = listBounties();
    const bounty = bounties.find((item) => item.id === id);

    if (!bounty) {
      jsonError(res, req, 404, 'Bounty not found.');
      return;
    }

    res.setHeader('Cache-Control', `max-age=${appConfig.bountiesListCacheSeconds}`);

    if (bounty.version !== undefined) {
      const etag = `"${bounty.version}"`;
      res.setHeader('ETag', etag);

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
    }

    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error, 400);
  }
});

app.get('/api/maintainers/:maintainer/metrics', (req: Request, res: Response) => {
  try {
    const { maintainer } = req.params;

    if (!maintainer || typeof maintainer !== 'string') {
      jsonError(res, req, 400, 'Maintainer address is required.');
      return;
    }

    const metrics = getMaintainerMetrics(maintainer);
    res.json({ data: metrics });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get('/api/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    const metrics = await getMetrics();
    res.send(metrics);
  } catch {
    res.status(500).send('Error generating metrics');
  }
});

app.get('/api/global-metrics', (_req: Request, res: Response) => {
  try {
    const metrics = getGlobalMetrics();
    res.json({ data: metrics });
  } catch (error) {
    sendError(res, _req, error);
  }
});

app.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const metrics = await aggregatedMetrics.getCached();
    res.json({ data: metrics });
  } catch (error) {
    sendError(res, _req, error, 500);
  }
});

/**
 * GET /api/config
 *
 * Returns non-sensitive runtime configuration so the frontend and contract-
 * interaction layer can stay in sync without hardcoding values.
 *
 * Exposed values: fee bps, dispute window, min/max bounty amounts, supported
 * tokens (symbol → contract address), default reservation TTL, and network.
 *
 * Nothing sensitive (API keys, DB strings, webhook secrets, maintainer keys)
 * is ever included in this response.
 *
 * Cache-Control: max-age=300 (5 min) — these values change infrequently.
 */
app.get('/api/config', (_req: Request, res: Response) => {
  try {
    const config = getPublicConfig();
    res.setHeader(
      'Cache-Control',
      `public, max-age=${appConfig.configCacheSeconds}, stale-while-revalidate=${appConfig.configStaleWhileRevalidateSeconds}`
    );
    res.json({ data: config });
  } catch (error) {
    sendError(res, _req, error, 500);
  }
});

/**
 * GET /api/audit-log
 *
 * Admin-only endpoint that returns a paginated view of all audit log records
 * across every bounty.  Requires a valid `x-admin-api-key` header whose value
 * matches the bcrypt hash stored in `ADMIN_API_KEY_HASH`.
 */
app.get('/api/audit-log', createAdminApiKeyAuthMiddleware(), (req: Request, res: Response) => {
  try {
    const limit = parsePaginationValue(req.query.limit, 'limit', 50, 1, 200);
    const offset = parsePaginationValue(req.query.offset, 'offset', 0, 0);

    const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
    const transition = typeof req.query.transition === 'string' ? req.query.transition : undefined;
    const bountyId = typeof req.query.bountyId === 'string' ? req.query.bountyId : undefined;
    const fromStatus = typeof req.query.fromStatus === 'string' ? req.query.fromStatus : undefined;
    const toStatus = typeof req.query.toStatus === 'string' ? req.query.toStatus : undefined;

    const page = listAllAuditLogs({
      limit,
      offset,
      actor,
      transition,
      bountyId,
      fromStatus,
      toStatus,
    });
    res.json(page);
  } catch (error) {
    sendError(res, req, error);
  }
});

// ─── Browser push notification preferences ─────────────────────────────────

app.post(
  '/api/notification-preferences/push',
  mutationLimiter,
  requireJsonContentType,
  (req: Request, res: Response) => {
    try {
      const { endpoint, keys } = req.body ?? {};

      if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
        jsonError(res, req, 400, 'endpoint must be a valid https URL.');
        return;
      }

      if (
        !keys ||
        typeof keys !== 'object' ||
        typeof keys.p256dh !== 'string' ||
        typeof keys.auth !== 'string'
      ) {
        jsonError(res, req, 400, 'keys.p256dh and keys.auth are required.');
        return;
      }

      const subscription = registerPushSubscription({
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        createdAt: Date.now(),
      });

      res.status(201).json({ data: subscription });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.delete(
  '/api/notification-preferences/push',
  mutationLimiter,
  requireJsonContentType,
  (req: Request, res: Response) => {
    try {
      const { endpoint } = req.body ?? {};

      if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
        jsonError(res, req, 400, 'endpoint must be a valid https URL.');
        return;
      }

      const removed = unregisterPushSubscription(endpoint);
      res.json({ data: { removed } });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

// ─── Bounty lifecycle notification opt-in preferences ───────────────────────

app.post(
  '/api/notifications/opt-in',
  mutationLimiter,
  requireJsonContentType,
  (req: Request, res: Response) => {
    try {
      const { address, optIn, email, webhookUrl } = req.body ?? {};

      if (!address || typeof address !== 'string') {
        jsonError(res, req, 400, 'address is required.');
        return;
      }

      if (typeof optIn !== 'boolean') {
        jsonError(res, req, 400, 'optIn must be a boolean.');
        return;
      }

      const pref = setNotificationOptIn(address, optIn, { email, webhookUrl });
      res.json({ data: pref });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.get('/api/notifications/opt-in/:address', (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const pref = getNotificationOptIn(address);
    res.json({
      data: {
        address,
        optedIn: isNotificationOptedIn(address),
        preference: pref,
        supportedTransitions: NOTIFICATION_LIFECYCLE_TRANSITIONS,
      },
    });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get('/api/notification-preferences/:address', (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const pref = getNotificationOptIn(address);
    res.json({
      data: {
        address,
        optedIn: isNotificationOptedIn(address),
        channels: {
          email: Boolean(pref?.email),
          webhook: Boolean(pref?.webhookUrl),
          push: true,
        },
        events: NOTIFICATION_LIFECYCLE_TRANSITIONS.reduce(
          (acc, t) => {
            acc[t] = isNotificationOptedIn(address);
            return acc;
          },
          {} as Record<string, boolean>
        ),
        preference: pref,
        supportedTransitions: NOTIFICATION_LIFECYCLE_TRANSITIONS,
      },
    });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.put(
  '/api/notification-preferences/:address',
  mutationLimiter,
  requireJsonContentType,
  (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const { optIn = true, email, webhookUrl, channels, events } = req.body ?? {};

      if (!address || typeof address !== 'string') {
        jsonError(res, req, 400, 'address is required.');
        return;
      }

      const pref = setNotificationOptIn(address, Boolean(optIn), { email, webhookUrl });
      res.json({
        data: {
          address,
          optedIn: pref.optIn,
          channels: channels ?? {
            email: Boolean(pref.email),
            webhook: Boolean(pref.webhookUrl),
            push: true,
          },
          events:
            events ??
            NOTIFICATION_LIFECYCLE_TRANSITIONS.reduce(
              (acc, t) => {
                acc[t] = pref.optIn;
                return acc;
              },
              {} as Record<string, boolean>
            ),
          preference: pref,
          supportedTransitions: NOTIFICATION_LIFECYCLE_TRANSITIONS,
        },
      });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.put(
  '/api/notification-preferences',
  mutationLimiter,
  requireJsonContentType,
  (req: Request, res: Response) => {
    try {
      const { address, optIn = true, email, webhookUrl, channels, events } = req.body ?? {};

      if (!address || typeof address !== 'string') {
        jsonError(res, req, 400, 'address is required.');
        return;
      }

      const pref = setNotificationOptIn(address, Boolean(optIn), { email, webhookUrl });
      res.json({
        data: {
          address,
          optedIn: pref.optIn,
          channels: channels ?? {
            email: Boolean(pref.email),
            webhook: Boolean(pref.webhookUrl),
            push: true,
          },
          events:
            events ??
            NOTIFICATION_LIFECYCLE_TRANSITIONS.reduce(
              (acc, t) => {
                acc[t] = pref.optIn;
                return acc;
              },
              {} as Record<string, boolean>
            ),
          preference: pref,
          supportedTransitions: NOTIFICATION_LIFECYCLE_TRANSITIONS,
        },
      });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if ((err as any).type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload too large', maxBytes: 32768 });
    return;
  }
  if (
    err instanceof SyntaxError &&
    (err as any).type === 'entity.parse.failed' &&
    (err as any).body
  ) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  next(err);
});

// Must stay last: renders typed middleware errors and turns anything else into
// a generic 500 so no raw dependency error or stack trace reaches a client.
app.use(createTerminalErrorHandler());
