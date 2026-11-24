/**
 * In-memory API double for the bounty lifecycle E2E suite (#1952).
 *
 * The suite exercises create -> reserve -> submit -> release through the real
 * frontend, but replaces the Soroban/backend side with a deterministic double
 * so the test can never move funds and never needs live network access.
 *
 * The double is still strict about the values that matter: every transition is
 * validated against the resolved fixtures (contributor identity, release
 * signer, signed payload, signature header), and assertions fail on the request
 * that violates them rather than further down the UI.
 */

import assert from 'node:assert/strict';
import type { Page, Route } from '@playwright/test';
import {
  E2E_WALLET_SIGNATURE,
  isValidStellarPublicKey,
  type LifecycleFixtures,
} from './lifecycle-fixtures';

export type LifecycleStatus = 'open' | 'reserved' | 'submitted' | 'released' | 'refunded';

export interface LifecycleBounty {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  contributor?: string;
  tokenSymbol: string;
  amount: number;
  labels: Array<{ name: string; color: string }>;
  status: LifecycleStatus;
  createdAt: number;
  deadlineAt: number;
  version: number;
  events: Array<{ type: string; timestamp: number; actor?: string }>;
  submissionUrl?: string;
  releasedAt?: number;
}

export interface LifecycleRequestLog {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface LifecycleApiDoubleOptions {
  /** If set, fails the first `failReleaseCount` release requests to simulate delayed confirmation / timeout (SBB-2026-482) */
  failReleaseCount?: number;
  /** Custom error message on simulated release failure */
  releaseErrorMessage?: string;
  /** Artificial delay in ms before responding to release */
  releaseDelayMs?: number;
}

export interface LifecycleApiDouble {
  readonly bounties: LifecycleBounty[];
  readonly requests: LifecycleRequestLog[];
  reset(): void;
  setFailReleaseCount(count: number, errorMessage?: string): void;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function json(route: Route, status: number, payload: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

function readJsonBody(route: Route): Record<string, unknown> {
  try {
    return (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function installLifecycleApiDouble(
  page: Page,
  fixtures: LifecycleFixtures,
  options: LifecycleApiDoubleOptions = {}
): Promise<LifecycleApiDouble> {
  const bounties: LifecycleBounty[] = [];
  const requests: LifecycleRequestLog[] = [];
  let nextId = 1;
  let failReleaseCount = options.failReleaseCount ?? 0;
  let releaseErrorMessage = options.releaseErrorMessage ?? 'Contract confirmation delayed / timed out';
  const releaseDelayMs = options.releaseDelayMs ?? 0;

  function findBounty(id: string): LifecycleBounty {
    const bounty = bounties.find((candidate) => candidate.id === id);
    assert.ok(bounty, `API double received a request for unknown bounty ${id}`);
    return bounty;
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    const body = method === 'GET' ? undefined : readJsonBody(route);

    requests.push({
      method,
      path,
      body,
      headers: request.headers(),
    });

    if (method === 'GET' && path === '/bounties') {
      await json(route, 200, {
        data: bounties,
        total: bounties.length,
        page: 1,
        pageSize: 10,
        hasMore: false,
      });
      return;
    }

    if (method === 'GET' && path === '/open-issues') {
      await json(route, 200, { data: [] });
      return;
    }

    if (method === 'POST' && path === '/bounties') {
      const payload = body ?? {};
      assert.match(String(payload.repo), /^[^/]+\/[^/]+$/, 'create: repo must be owner/name');
      assert.ok(
        Number.isInteger(payload.issueNumber) && Number(payload.issueNumber) > 0,
        'create: issueNumber must be a positive integer'
      );
      assert.ok(String(payload.title ?? '').trim(), 'create: title must be present');
      assert.ok(Number(payload.amount) > 0, 'create: amount must be greater than zero');
      assert.ok(
        isValidStellarPublicKey(payload.maintainer),
        'create: maintainer must be a valid Stellar public key'
      );

      const createdAt = nowSeconds();
      const bounty: LifecycleBounty = {
        id: `e2e-bounty-${nextId++}`,
        repo: String(payload.repo),
        issueNumber: Number(payload.issueNumber),
        title: String(payload.title),
        summary: String(payload.summary ?? ''),
        // The escrow double is funded by the validated maintainer fixture, so
        // the release signer is the account the fixture authorized.
        maintainer: fixtures.maintainer,
        tokenSymbol: String(payload.tokenSymbol ?? 'XLM'),
        amount: Number(payload.amount),
        labels: Array.isArray(payload.labels)
          ? (payload.labels as Array<{ name: string; color: string }>)
          : [],
        status: 'open',
        createdAt,
        deadlineAt: createdAt + Number(payload.deadlineDays ?? 7) * 86_400,
        version: 1,
        events: [{ type: 'created', timestamp: createdAt, actor: fixtures.maintainer }],
      };
      bounties.push(bounty);
      await json(route, 201, { data: bounty });
      return;
    }

    const match = path.match(/^\/bounties\/([^/]+)(?:\/([a-z-]+))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      const action = match[2];

      if (!action && method === 'GET') {
        await json(route, 200, { data: findBounty(id) });
        return;
      }

      const bounty = findBounty(id);
      const payload = body ?? {};

      if (method === 'POST' && action === 'reserve') {
        assert.equal(bounty.status, 'open', 'reserve: bounty must be open');
        assert.equal(
          payload.contributor,
          fixtures.contributor,
          'reserve: contributor must be the validated contributor fixture'
        );
        bounty.status = 'reserved';
        bounty.contributor = fixtures.contributor;
        bounty.version += 1;
        bounty.events.push({
          type: 'reserved',
          timestamp: nowSeconds(),
          actor: fixtures.contributor,
        });
        await json(route, 200, { data: bounty });
        return;
      }

      if (method === 'POST' && action === 'submit') {
        assert.equal(bounty.status, 'reserved', 'submit: bounty must be reserved');
        assert.equal(
          payload.contributor,
          fixtures.contributor,
          'submit: contributor must match the reservation'
        );
        assert.match(
          String(payload.submissionUrl ?? ''),
          /^https:\/\//,
          'submit: submission URL must be https'
        );
        bounty.status = 'submitted';
        bounty.submissionUrl = String(payload.submissionUrl);
        bounty.version += 1;
        bounty.events.push({
          type: 'submitted',
          timestamp: nowSeconds(),
          actor: fixtures.contributor,
        });
        await json(route, 200, { data: bounty });
        return;
      }

      if (method === 'POST' && action === 'release') {
        assert.equal(bounty.status, 'submitted', 'release: bounty must be submitted');
        const headers = request.headers();
        assert.equal(
          headers['x-stellar-public-key'],
          fixtures.maintainer,
          'release: signer must be the validated maintainer fixture'
        );
        assert.equal(
          headers['x-stellar-signature'],
          E2E_WALLET_SIGNATURE,
          'release: request must carry the signature produced by the wallet double'
        );
        assert.equal(
          payload.maintainer,
          fixtures.maintainer,
          'release: payload maintainer must be the validated maintainer fixture'
        );
        assert.equal(payload.action, 'release', 'release: payload action must be release');
        assert.equal(payload.bountyId, bounty.id, 'release: payload bountyId must match the route');
        assert.equal(
          typeof payload.timestamp,
          'number',
          'release: payload timestamp must be a number'
        );

        if (releaseDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, releaseDelayMs));
        }

        if (failReleaseCount > 0) {
          failReleaseCount -= 1;
          await json(route, 504, { error: releaseErrorMessage });
          return;
        }

        bounty.status = 'released';
        bounty.releasedAt = nowSeconds();
        bounty.version += 1;
        bounty.events.push({
          type: 'released',
          timestamp: bounty.releasedAt,
          actor: fixtures.maintainer,
        });
        await json(route, 200, { data: bounty });
        return;
      }

      await json(route, 400, { error: `API double does not handle ${method} ${path}` });
      return;
    }

    await json(route, 200, { data: [] });
  });

  return {
    get bounties() {
      return bounties;
    },
    get requests() {
      return requests;
    },
    reset() {
      bounties.length = 0;
      requests.length = 0;
      nextId = 1;
      failReleaseCount = 0;
    },
    setFailReleaseCount(count: number, errorMessage?: string) {
      failReleaseCount = count;
      if (errorMessage) {
        releaseErrorMessage = errorMessage;
      }
    },
  };
}
