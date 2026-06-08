import compression from 'compression';
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { buildCorsOptions } from './middleware/corsOptions';
import { generateOpenApiDocument } from './docs/openapi';
import { logStructured } from './logger';
import { getMetrics, httpRequestDuration } from './metrics';
import { mutationLimiter, readLimiter } from './utils';

import {
  createBounty,
  listBountyAuditLogs,
  listAllAuditLogs,
  listBounties,
  listBountiesCached,
  invalidateBountyCache,
  refundBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
  getBountyEvents,
  getMaintainerMetrics,
  getGlobalMetrics,
  getLeaderboard,
} from './services/bountyStore';

import {
  bountyIdSchema,
  createBountySchema,
  maintainerActionSchema,
  reserveBountySchema,
  submitBountySchema,
  zodErrorMessage,
} from './validation/schemas';

import {
  captureRawBody,
  createGitHubWebhookSignatureMiddleware,
} from './webhooks/signatureVerification';
import {
  createBountyCreationSignatureMiddleware,
  createStellarSignatureAuthMiddleware,
} from './middleware/auth';
import { handleGitHubPrEvent } from './webhooks/githubPrHandler';

const INCOMING_REQUEST_ID = /^[a-zA-Z0-9-]{1,128}$/;
const DEFAULT_SOROBAN_RPC_URL = 'https://rpc-futurenet.stellar.org';
const DEEP_HEALTH_CACHE_MS = 10_000;

type ComponentStatus = 'up' | 'down';

interface DeepHealthResponse {
  overall: ComponentStatus;
  components: {
    store: ComponentStatus;
    soroban: ComponentStatus;
    contract: ComponentStatus;
    auth: ComponentStatus;
  };
}

let deepHealthCache: { expiresAt: number; value: DeepHealthResponse } | null = null;

function resolveStorePath(): string {
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim());
  }

  return path.resolve(__dirname, '../data/bounties.json');
}

function checkStoreHealth(): ComponentStatus {
  const storePath = resolveStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, '[]\n', 'utf8');
  }

  const raw = fs.readFileSync(storePath, 'utf8');
  JSON.parse(raw.trim() || '[]');
  fs.writeFileSync(storePath, raw, 'utf8');

  return 'up';
}

async function checkSorobanHealth(): Promise<ComponentStatus> {
  const rpcUrl = process.env.SOROBAN_RPC_URL?.trim() || DEFAULT_SOROBAN_RPC_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'health', method: 'getHealth' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return 'down';
    }

    const body = (await response.json()) as { error?: unknown };
    return body.error ? 'down' : 'up';
  } finally {
    clearTimeout(timeout);
  }
}

function hasAnyEnv(...names: string[]): boolean {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

async function buildDeepHealth(): Promise<DeepHealthResponse> {
  const checks = await Promise.allSettled([
    Promise.resolve().then(() => checkStoreHealth()),
    Promise.resolve().then(() => checkSorobanHealth()),
  ]);
  const store = checks[0].status === 'fulfilled' ? checks[0].value : 'down';
  const soroban = checks[1].status === 'fulfilled' ? checks[1].value : 'down';
  const contract = hasAnyEnv('CONTRACT_ID', 'SOROBAN_CONTRACT_ID') ? 'up' : 'down';
  const auth =
    hasAnyEnv('MAINTAINER_PUBLIC_KEY', 'MAINTAINER_PUBLIC_KEYS') &&
    hasAnyEnv('ARBITER_ADDRESS')
      ? 'up'
      : 'down';

  const components = { store, soroban, contract, auth };
  const overall = Object.values(components).every((status) => status === 'up') ? 'up' : 'down';

  return { overall, components };
}

async function getDeepHealthCached(): Promise<DeepHealthResponse> {
  const now = Date.now();

  if (deepHealthCache && deepHealthCache.expiresAt > now) {
    return deepHealthCache.value;
  }

  const value = await buildDeepHealth();
  deepHealthCache = { value, expiresAt: now + DEEP_HEALTH_CACHE_MS };

  return value;
}

async function deepHealthHandler(_req: Request, res: Response): Promise<void> {
  const health = await getDeepHealthCached();
  res.status(health.overall === 'up' ? 200 : 503).json(health);
}

function resolveRequestId(req: Request): string {
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
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

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

    logStructured('info', 'http_request', {
      requestId,
      method: req.method,
      path: req.path || '/',
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  });

  next();
}

export const app = express();

app.use(cors(buildCorsOptions()));

app.use(
  express.json({
    verify: captureRawBody,
  })
);

app.use(requestContextMiddleware);
app.get('/api/health/deep', deepHealthHandler);
app.use(readLimiter);

const swaggerDoc = generateOpenApiDocument();
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

function parseId(raw: string | string[] | undefined): string {
  return bountyIdSchema.parse(Array.isArray(raw) ? raw[0] : raw);
}

function parsePaginationValue(
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

function jsonError(res: Response, req: Request, statusCode: number, message: string): void {
  res.status(statusCode).json({ error: message, requestId: req.requestId });
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const raw = String(value);

  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

function sendError(res: Response, req: Request, error: unknown, statusCode = 400): void {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  jsonError(res, req, statusCode, message);
}

function validateBountyAmount(amount: number): string | null {
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

const healthHandler = (_req: Request, res: Response) => {
  res.json({
    service: 'stellar-bounty-board-api',
    status: 'ok',
    timestamp: new Date().toISOString(),

  });
};

app.get('/api/health', healthHandler);

app.get('/worker/health', (_req: Request, res: Response) => {
  res.json({
    service: 'stellar-bounty-board-worker',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/bounties', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  res.json({ data: await listBountiesCached({ q }) });
});

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
  mutationLimiter,
  createBountyCreationSignatureMiddleware(),
  async (req: Request, res: Response) => {
    const parsed = createBountySchema.safeParse(req.body);

    if (!parsed.success) {
      jsonError(res, req, 400, zodErrorMessage(parsed.error));
      return;
    }

    const amountError = validateBountyAmount(parsed.data.amount);

    if (amountError) {
      jsonError(res, req, 400, amountError);
      return;
    }

    try {
      const bounty = await createBounty(parsed.data);
      res.status(201).json({ data: bounty });
    } catch (error) {
      sendError(res, req, error);
    }
  }
);

app.post('/api/bounties/:id/reserve', mutationLimiter, async (req: Request, res: Response) => {
  const parsedBody = reserveBountySchema.safeParse(req.body);

  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

  try {
    const bounty = await reserveBounty(
      parseId(req.params.id),
      parsedBody.data.contributor,
      parsedBody.data.expectedVersion
    );

    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post('/api/bounties/:id/submit', mutationLimiter, async (req: Request, res: Response) => {
  const parsedBody = submitBountySchema.safeParse(req.body);

  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

  try {
    const bounty = await submitBounty(
      parseId(req.params.id),
      parsedBody.data.contributor,
      parsedBody.data.submissionUrl,
      parsedBody.data.notes
    );

    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post(
  '/api/bounties/:id/release',
  mutationLimiter,
  createStellarSignatureAuthMiddleware(),
  async (req: Request, res: Response) => {
    const parsedBody = maintainerActionSchema.safeParse(req.body);

    if (!parsedBody.success) {
      jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
      return;
    }

    try {
      const bounty = await releaseBounty(
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
  '/api/bounties/:id/refund',
  mutationLimiter,
  createStellarSignatureAuthMiddleware(),
  async (req: Request, res: Response) => {
    const parsedBody = maintainerActionSchema.safeParse(req.body);

    if (!parsedBody.success) {
      jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
      return;
    }

    try {
      const bounty = await refundBounty(
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
  '/api/webhooks/github',
  createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET),
  async (req: Request, res: Response) => {
    try {
      await handleGitHubPrEvent(req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook processing error';

      res.status(500).json({ error: message, requestId: req.requestId });
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

app.get('/api/open-issues', async (_req: Request, res: Response) => {

});

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

/**
 * GET /api/audit-log
 *
 * Admin-only endpoint that returns a paginated view of all audit log records
 * across every bounty.  Requires a valid `x-admin-api-key` header whose value
 * matches the bcrypt hash stored in `ADMIN_API_KEY_HASH`.
 */
app.get(
  "/api/audit-log",
  createAdminApiKeyAuthMiddleware(),
  (req: Request, res: Response) => {
    try {
      const limit = parsePaginationValue(req.query.limit, "limit", 50, 1, 200);
      const offset = parsePaginationValue(req.query.offset, "offset", 0, 0);
      const page = listAllAuditLogs({ limit, offset });
      res.json(page);
    } catch (error) {
      sendError(res, req, error);
    }
  },
);
