import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import swaggerUi from 'swagger-ui-express';

import { generateOpenApiDocument } from './docs/openapi';
import { getMetrics, httpRequestDuration } from './metrics';

import {
  createBounty,
  disputeBounty,
  extendDeadline,
  updateBountyNotes,
  updateBountyMetadata,
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
  bountyIdSchema,
  createBountySchema,
  disputeBountySchema,
  extendDeadlineSchema,
  maintainerActionSchema,
  reserveBountySchema,
  submitBountySchema,
  updateNotesSchema,
  updateMetadataSchema,
} from './validation/schemas';
import { validateBody } from './middleware/validateBody';
import { isValidStellarAddress } from './utils';

import {
  captureRawBody,
  createGitHubWebhookSignatureMiddleware,
} from './webhooks/signatureVerification';
import {
  createBountyCreationSignatureMiddleware,
  createStellarSignatureAuthMiddleware,
} from './middleware/auth';
import { idempotencyMiddleware } from './middleware/idempotency';
import { requireJsonContentType } from './middleware/contentType';
import { readLimiter, mutationLimiter } from './utils';
import { logger } from './logger';
import { createAdminApiKeyAuthMiddleware } from './middleware/adminAuth';
import { handleGitHubPrEvent } from './webhooks/githubPrHandler';
import { draining } from './shutdown';


const INCOMING_REQUEST_ID = /^[a-zA-Z0-9-]{1,128}$/;

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



app.use(cors(buildCorsOptions()));

app.use(
  express.json({
    verify: captureRawBody,
    limit: '32kb',
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

const healthHandler = (_req: Request, res: Response) => {
  res.json({
    service: 'stellar-bounty-board-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};

app.get('/api/health', healthHandler);

app.get('/api/health/deep', async (_req: Request, res: Response) => {
  const result = await runDeepHealthCheck();
  const statusCode = result.overall === 'up' ? 200 : 503;
  res.status(statusCode).json(result);
});

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

app.get('/api/bounties', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const contributor =
      typeof req.query.contributor === 'string' && req.query.contributor.trim()
        ? req.query.contributor.trim()
        : undefined;
    const maintainer =
      typeof req.query.maintainer === 'string' && req.query.maintainer.trim()
        ? req.query.maintainer.trim()
        : undefined;
    const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : undefined;
    const tokenSymbol =
      typeof req.query.tokenSymbol === 'string' && req.query.tokenSymbol.trim()
        ? req.query.tokenSymbol.trim()
        : undefined;
    const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : 'createdAt';
    const order = typeof req.query.order === 'string' && req.query.order.trim() ? req.query.order.trim() : 'desc';
    const page = parsePaginationValue(req.query.page, 'page', 1, 1);
    const pageSize = parsePaginationValue(req.query.pageSize, 'pageSize', 20, 1, 100);

    let deadlineBefore: number | undefined;
    if (typeof req.query.deadlineBefore === 'string') {
      const date = new Date(req.query.deadlineBefore);
      if (isNaN(date.getTime())) {
        throw new Error('deadlineBefore must be a valid ISO 8601 date string');
      }
      deadlineBefore = Math.floor(date.getTime() / 1000);
    }

    let deadlineAfter: number | undefined;
    if (typeof req.query.deadlineAfter === 'string') {
      const date = new Date(req.query.deadlineAfter);
      if (isNaN(date.getTime())) {
        throw new Error('deadlineAfter must be a valid ISO 8601 date string');
      }
      deadlineAfter = Math.floor(date.getTime() / 1000);
    }

    if (contributor && !isValidStellarAddress(contributor)) {
      throw new Error('contributor must be a valid Stellar public key');
    }
    if (maintainer && !isValidStellarAddress(maintainer)) {
      throw new Error('maintainer must be a valid Stellar public key');
    }
    if (!['amount', 'deadline', 'createdAt', 'status'].includes(sort)) {
      throw new Error('sort must be one of: amount, deadline, createdAt, status');
    }
    if (!['asc', 'desc'].includes(order)) {
      throw new Error('order must be one of: asc, desc');
    }

    const all = await listBountiesCached({
      q,
      contributor,
      maintainer,
      status: status as never,
      tokenSymbol,
      deadlineBefore,
      deadlineAfter,
      sort: sort as never,
      order: order as never,
    });
    const total = all.length;
    const start = (page - 1) * pageSize;
    const data = all.slice(start, start + pageSize);
    const hasMore = start + data.length < total;

    res.setHeader('X-Total-Count', String(total));
    res.json({ data, total, page, pageSize, hasMore });
  } catch (error) {
    sendError(res, req, error);
  }
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
  mutationLimiter,
  requireJsonContentType,
  createBountyCreationSignatureMiddleware(),
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

app.post('/api/bounties/:id/reserve', mutationLimiter, requireJsonContentType, idempotencyMiddleware, async (req: Request, res: Response) => {
  const parsedBody = reserveBountySchema.safeParse(req.body);

  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

app.post('/api/bounties/:id/reserve', mutationLimiter, idempotencyMiddleware, validateBody(reserveBountySchema), async (req: Request, res: Response) => {
  try {
    const bounty = await reserveBounty(
      parseId(req.params.id),
      req.body.contributor,
      req.body.expectedVersion
    );

    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post('/api/bounties/:id/submit', mutationLimiter, requireJsonContentType, idempotencyMiddleware, async (req: Request, res: Response) => {
  const parsedBody = submitBountySchema.safeParse(req.body);

  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

app.post('/api/bounties/:id/submit', mutationLimiter, idempotencyMiddleware, validateBody(submitBountySchema), async (req: Request, res: Response) => {
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
});

app.post(
  '/api/bounties/:id/release',
  mutationLimiter,
  requireJsonContentType,
  idempotencyMiddleware,
  createStellarSignatureAuthMiddleware(),
  validateBody(maintainerActionSchema),
  async (req: Request, res: Response) => {
    try {
      const bounty = await releaseBounty(
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

app.post(
  '/api/bounties/:id/refund',
  mutationLimiter,
  idempotencyMiddleware,
  createStellarSignatureAuthMiddleware(),
  validateBody(maintainerActionSchema),
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

app.post(
  '/api/bounties/:id/cancel',
  mutationLimiter,
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

app.patch(
  '/api/bounties/:id/metadata',
  mutationLimiter,
  requireJsonContentType,
  createStellarSignatureAuthMiddleware(),
  validateBody(updateMetadataSchema),
  async (req: Request, res: Response) => {
    try {
      const bounty = await updateBountyMetadata(
        parseId(req.params.id),
        req.body.maintainer,
        req.body.newTitle
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
  try {

  }
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

    res.setHeader('Cache-Control', 'max-age=5');

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
      
      const actor = typeof req.query.actor === "string" ? req.query.actor : undefined;
      const transition = typeof req.query.transition === "string" ? req.query.transition : undefined;
      const bountyId = typeof req.query.bountyId === "string" ? req.query.bountyId : undefined;
      const fromStatus = typeof req.query.fromStatus === "string" ? req.query.fromStatus : undefined;
      const toStatus = typeof req.query.toStatus === "string" ? req.query.toStatus : undefined;
      
      const page = listAllAuditLogs({ 
        limit, 
        offset, 
        actor, 
        transition, 
        bountyId, 
        fromStatus, 
        toStatus 
      });
      res.json(page);
    } catch (error) {
      sendError(res, req, error);
    }
  },
);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if ((err as any).type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload too large', maxBytes: 32768 });
    return;
  }
  if (err instanceof SyntaxError && (err as any).type === 'entity.parse.failed' && (err as any).body) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  next(err);
});
