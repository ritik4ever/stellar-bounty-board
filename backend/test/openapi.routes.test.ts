import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { app } from '../src/app';

/**
 * OpenAPI Route Drift Test
 *
 * Loads docs/openapi.generated.json and cross-checks it against the live
 * Express router to ensure the two stay in sync.
 *
 * The test fails if:
 *  - A documented route/method no longer exists on the live app
 *  - A live API route/method is absent from the spec (and not in the
 *    UNDOCUMENTED_ROUTES allowlist below)
 *
 * ALLOWLISTED UNDOCUMENTED ROUTES
 * These routes exist on the live app but are intentionally excluded from the
 * public OpenAPI spec (internal, infra, or admin-only endpoints).  Add to
 * this list only when the omission is deliberate.
 */
const UNDOCUMENTED_ROUTES = new Set([
  // Infrastructure / health
  'GET /worker/health',
  // Prometheus metrics (plain text, not JSON)
  'GET /api/metrics',
  // Aggregated cached stats alias — separate from /api/stats documented endpoint
  // (already documented; keeping entry in case a second alias is added)
  // Admin-only — protected by API key, not part of the public surface
  'GET /api/global-metrics',
  // Per-maintainer metrics — undocumented internal endpoint
  'GET /api/maintainers/:maintainer/metrics',
  // Bounty event history — undocumented internal endpoint
  'GET /api/bounties/:id/events',
  // Legacy paginated audit-log alias (/:id/audit-logs vs /:id/audit-log)
  'GET /api/bounties/:id/audit-logs',
  // Released bounties CSV export — undocumented internal endpoint
  'GET /api/bounties/released/export.csv',
  // Look-up bounty by repo + issue number — undocumented
  'GET /api/bounties/by-issue',
  // Single-bounty detail — undocumented
  'GET /api/bounties/:id',
  // GitHub webhook — internal integration endpoint
  'POST /api/webhooks/github',
  // Maintainer bulk release/refund — admin-only (#829)
  'POST /api/bounties/bulk-action',
  // Dispute resolution — undocumented internal endpoint
  'POST /api/bounties/:id/resolve-dispute',
  // Public runtime config — undocumented internal endpoint
  'GET /api/config',
  // Bounty dispute — undocumented
  'POST /api/bounties/:id/dispute',
  // Extend deadline — undocumented
  'POST /api/bounties/:id/extend-deadline',
  // SEO helpers — not API routes
  'GET /robots.txt',
  'GET /sitemap.xml',
]);

// HTTP methods recognised by OpenAPI
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/**
 * Normalise an OpenAPI path to Express-style parameter syntax.
 *
 * OpenAPI uses `{id}` placeholders; Express uses `:id`.  The existing spec
 * also contains a handful of paths that already use `:id` directly — those
 * pass through unchanged.
 *
 * Examples:
 *   /api/bounties/{id}/reserve  →  /api/bounties/:id/reserve
 *   /api/bounties/:id/refund    →  /api/bounties/:id/refund  (no-op)
 */
function normaliseSpecPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

/** Extract all route entries registered on an Express application. */
function extractExpressRoutes(expressApp: Express.Application): Set<string> {
  const routes = new Set<string>();

  // Express stores routes in app._router.stack.  Each layer is either a route
  // layer (layer.route exists) or a middleware layer.  We only care about
  // route layers here.
  const stack: unknown[] = (expressApp as any)._router?.stack ?? [];

  for (const layer of stack) {
    const route = (layer as any).route;

    if (!route) continue;

    const routePath: string = route.path;

    // route.methods is an object like { get: true, post: true }
    const methods: Record<string, boolean> = route.methods ?? {};

    for (const [method, active] of Object.entries(methods)) {
      if (active && HTTP_METHODS.has(method.toLowerCase())) {
        routes.add(`${method.toUpperCase()} ${routePath}`);
      }
    }
  }

  return routes;
}

/** Load and parse the generated OpenAPI spec from the repo root. */
function loadSpecRoutes(): Set<string> {
  // The test runs from the backend/ working directory; the spec lives one
  // level up in docs/.
  const specPath = join(__dirname, '..', '..', 'docs', 'openapi.generated.json');
  const raw = readFileSync(specPath, 'utf-8');
  const spec = JSON.parse(raw) as { paths?: Record<string, Record<string, unknown>> };

  const routes = new Set<string>();
  const paths = spec.paths ?? {};

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    const normalisedPath = normaliseSpecPath(rawPath);

    for (const method of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(method.toLowerCase())) {
        routes.add(`${method.toUpperCase()} ${normalisedPath}`);
      }
    }
  }

  return routes;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpenAPI route drift detection', () => {
  const specRoutes = loadSpecRoutes();
  const liveRoutes = extractExpressRoutes(app);

  it('every documented route exists on the live Express app', () => {
    const missing: string[] = [];

    for (const specRoute of specRoutes) {
      if (!liveRoutes.has(specRoute)) {
        missing.push(specRoute);
      }
    }

    expect(
      missing,
      `Documented routes not found on the live app:\n${missing.map((r) => `  - ${r}`).join('\n')}\n\nIf these routes were intentionally removed, update docs/openapi.generated.json to match.`
    ).toHaveLength(0);
  });

  it('every live API route is either documented or allowlisted', () => {
    const undocumented: string[] = [];

    for (const liveRoute of liveRoutes) {
      if (!specRoutes.has(liveRoute) && !UNDOCUMENTED_ROUTES.has(liveRoute)) {
        undocumented.push(liveRoute);
      }
    }

    expect(
      undocumented,
      `Live routes missing from the OpenAPI spec (and not allowlisted):\n${undocumented.map((r) => `  - ${r}`).join('\n')}\n\nEither document the route in docs/openapi.generated.json or add it to UNDOCUMENTED_ROUTES in this test.`
    ).toHaveLength(0);
  });
});
