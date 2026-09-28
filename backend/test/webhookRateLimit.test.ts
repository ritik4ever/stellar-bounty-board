import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../src/utils';
import { getOperationalConfig } from '../src/config';
import {
  captureRawBody,
  createGitHubWebhookSignatureMiddleware,
  githubWebhookSignatureProfile,
  signWebhookPayload,
} from '../src/webhooks/signatureVerification';

/**
 * #1460 — the webhook route gets its own rate limit, and signature
 * verification has to run *before* rate-limit accounting.
 *
 * The limiters exported from `src/utils.ts` are switched off during the test
 * run (see `rateLimitGuard.ts`), so these tests build their own limiter through
 * `createRateLimiter({ disabled: false })` to exercise real enforcement.
 */

const secret = 'webhook-rate-limit-test-secret';

function sign(rawPayload: string): string {
  return signWebhookPayload({
    payload: Buffer.from(rawPayload, 'utf8'),
    secret,
    algorithm: githubWebhookSignatureProfile.algorithm,
    prefix: githubWebhookSignatureProfile.prefix,
  });
}

function handler(_req: express.Request, res: express.Response): void {
  res.status(202).json({ data: { received: true } });
}

/** Mirrors the route order in `src/app.ts`: signature first, then the limiter. */
function buildSignatureFirstApp(limit: number): express.Express {
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.post(
    '/api/webhooks/github',
    createGitHubWebhookSignatureMiddleware(() => secret),
    createRateLimiter({ limit, disabled: false }),
    handler
  );
  return app;
}

/** The naive order #1460 warns about: limiter first, signature second. */
function buildLimiterFirstApp(limit: number): express.Express {
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.post(
    '/api/webhooks/github',
    createRateLimiter({ limit, disabled: false }),
    createGitHubWebhookSignatureMiddleware(() => secret),
    handler
  );
  return app;
}

describe('webhook rate limiting (#1460)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('ceiling and response shape', () => {
    it('allows up to the configured ceiling, then answers 429 with Retry-After', async () => {
      const app = buildSignatureFirstApp(2);
      const payload = JSON.stringify({ action: 'opened' });
      const signature = sign(payload);

      const send = () =>
        request(app)
          .post('/api/webhooks/github')
          .set('Content-Type', 'application/json')
          .set('X-Hub-Signature-256', signature)
          .send(payload);

      const first = await send();
      const second = await send();
      const third = await send();

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(third.status).toBe(429);
      expect(third.body).toEqual({ error: 'Too many requests. Please retry later.' });
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      expect(third.headers['ratelimit']).toBeDefined();
    });

    it('is disabled by the test bypass, so unrelated suites can post freely', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('RATE_LIMIT_TEST_BYPASS', 'true');

      const app = express();
      app.post('/webhook', createRateLimiter({ limit: 1 }), handler);

      for (let i = 0; i < 5; i += 1) {
        const response = await request(app).post('/webhook');
        expect(response.status).toBe(202);
      }
    });
  });

  describe('signature verification precedes rate-limit accounting', () => {
    it('does not spend the quota on unsigned requests', async () => {
      const app = buildSignatureFirstApp(3);
      const payload = JSON.stringify({ action: 'opened' });
      const signature = sign(payload);

      // 20 unsigned attempts — every one must be rejected by signature
      // verification, and none of them may touch the rate-limit counter.
      for (let i = 0; i < 20; i += 1) {
        const rejected = await request(app)
          .post('/api/webhooks/github')
          .set('Content-Type', 'application/json')
          .send(payload);

        expect(rejected.status).toBe(401);
      }

      // A genuine delivery still has the full quota available.
      const delivered = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload);

      expect(delivered.status).toBe(202);
    });

    it('rejects a tampered signature without counting it either', async () => {
      const app = buildSignatureFirstApp(1);
      const payload = JSON.stringify({ action: 'opened' });
      const tampered = sign(payload).slice(0, -1) + '0';

      const rejected = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', tampered)
        .send(payload);

      expect(rejected.status).toBe(401);

      const delivered = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(payload))
        .send(payload);

      expect(delivered.status).toBe(202);
    });

    it('shows the naive reversed order would let a spoofed flood block real deliveries', async () => {
      const app = buildLimiterFirstApp(2);
      const payload = JSON.stringify({ action: 'opened' });

      const first = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .send(payload);
      const second = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .send(payload);
      const third = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(first.status).toBe(401);
      expect(second.status).toBe(401);
      // Quota spent by unsigned traffic, so the third request is throttled
      // before its signature is ever checked.
      expect(third.status).toBe(429);

      const genuine = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(payload))
        .send(payload);

      expect(genuine.status).toBe(429);
    });
  });

  describe('RATE_LIMIT_WEBHOOK_MAX configuration', () => {
    it('defaults to 300 requests per window', () => {
      vi.stubEnv('RATE_LIMIT_WEBHOOK_MAX', '');
      expect(getOperationalConfig().rateLimitWebhookMax).toBe(300);
    });

    it('honours an explicit override', () => {
      vi.stubEnv('RATE_LIMIT_WEBHOOK_MAX', '1500');
      expect(getOperationalConfig().rateLimitWebhookMax).toBe(1500);
    });

    it('falls back to the default for a non-positive or non-numeric value', () => {
      for (const value of ['0', '-5', 'lots', 'NaN']) {
        vi.stubEnv('RATE_LIMIT_WEBHOOK_MAX', value);
        expect(getOperationalConfig().rateLimitWebhookMax).toBe(300);
      }
    });

    it('stays independent of the read and mutation ceilings', () => {
      vi.stubEnv('RATE_LIMIT_READ_MAX', '120');
      vi.stubEnv('RATE_LIMIT_MUTATION_MAX', '10');
      vi.stubEnv('RATE_LIMIT_WEBHOOK_MAX', '300');

      const config = getOperationalConfig();

      expect(config.rateLimitReadMax).toBe(120);
      expect(config.rateLimitMutationMax).toBe(10);
      expect(config.rateLimitWebhookMax).toBe(300);
    });
  });
});
