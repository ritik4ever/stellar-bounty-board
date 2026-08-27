import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from './fixtures';

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-reserve-concurrency-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  // Clear require cache to ensure fresh store state for each test
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    const auditStorePath = storeFile.replace(/\.json$/i, '.audit.json');
    fs.unlinkSync(auditStorePath);
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import('../src/app');
  return app;
}

/** Read the raw persisted store file so assertions see what was actually written. */
function readPersistedStore(): Array<{
  id: string;
  status: string;
  version: number;
  contributor?: string;
  events: Array<{ type: string }>;
}> {
  return JSON.parse(fs.readFileSync(storeFile, 'utf8'));
}

describe('concurrent reserveBounty requests — JSON-backed store', () => {
  it('two near-simultaneous reserves: exactly one wins (200) and the loser gets 409', async () => {
    const app = await getApp();

    // 1. Create a bounty (starts at version 1)
    const createRes = await request(app).post('/api/bounties').send(validCreateBody).expect(201);
    const id = createRes.body.data.id as string;
    expect(createRes.body.data.version).toBe(1);
    expect(createRes.body.data.status).toBe('open');

    // 2. Fire two near-simultaneous reserve requests for the same bounty.
    //    Promise.all fires them back-to-back so they race in the store.
    const [a, b] = await Promise.all([
      request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }),
      request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: OTHER_ACCOUNT }),
    ]);

    // 3. Exactly one request succeeds; the loser receives a 409 Conflict
    //    rather than silently overwriting state.
    const statuses = [a.status, b.status].sort();
    expect(statuses, `expected [200, 409], got ${JSON.stringify(statuses)}`).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;

    expect(winner.body.data.status).toBe('reserved');
    expect([CONTRIBUTOR, OTHER_ACCOUNT]).toContain(winner.body.data.contributor);
    expect(loser.body.error).toBeTruthy();

    // 4. The version/lock field increments exactly once on the winning write
    //    (1 -> 2): the winner's response reflects it…
    expect(winner.body.data.version).toBe(2);

    // …and so does the persisted store record.
    const persisted = readPersistedStore();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe('reserved');
    expect(persisted[0].version).toBe(2);
    expect([CONTRIBUTOR, OTHER_ACCOUNT]).toContain(persisted[0].contributor);
    expect(persisted[0].events.filter((e) => e.type === 'reserved')).toHaveLength(1);

    // The GET endpoint also exposes the bumped version via ETag.
    const getRes = await request(app).get(`/api/bounties/${id}`).expect(200);
    expect(getRes.headers.etag).toBe(`"2"`);
    expect(getRes.body.data.version).toBe(2);
  });

  it('a reserve attempt against an already-reserved bounty returns 409', async () => {
    const app = await getApp();
    const { body: created } = await request(app)
      .post('/api/bounties')
      .send(validCreateBody)
      .expect(201);
    const id = created.data.id as string;

    await request(app)
      .post(`/api/bounties/${id}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    const second = await request(app)
      .post(`/api/bounties/${id}/reserve`)
      .send({ contributor: OTHER_ACCOUNT })
      .expect(409);
    expect(second.body.error).toMatch(/only open bounties/i);
  });

  it('a stale expectedVersion on reserve returns 409', async () => {
    // Seed an *open* bounty whose version is already 3 (e.g. after prior
    // transitions) so the optimistic-lock check is the failing branch.
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      storeFile,
      JSON.stringify([
        {
          id: 'BNT-0001',
          repo: 'owner/repo-name',
          issueNumber: 99,
          title: 'Seeded bounty for stale version test',
          summary: 'Summary with at least twenty characters for validation here.',
          maintainer: MAINTAINER,
          tokenSymbol: 'XLM',
          tokenAddress: 'CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA',
          amount: 42.5,
          labels: ['bug'],
          status: 'open',
          createdAt: now,
          deadlineAt: now + 30 * 24 * 60 * 60,
          version: 3,
          events: [{ type: 'created', timestamp: now }],
          reservationTimeoutSeconds: 604800,
        },
      ]),
      'utf8'
    );

    const app = await getApp();
    const stale = await request(app)
      .post('/api/bounties/BNT-0001/reserve')
      .send({ contributor: CONTRIBUTOR, expectedVersion: 1 })
      .expect(409);
    expect(stale.body.error).toMatch(/reserved by someone else/i);
  });

  it('store-level: exactly one of two concurrent reserveBounty calls wins; version increments on the winning write', async () => {
    const { createBounty, reserveBounty } = await import('../src/services/bountyStore');

    const created = await createBounty({
      repo: 'owner/repo-name',
      issueNumber: 7,
      title: 'Concurrent store-level reserve test bounty',
      summary: 'Summary with at least twenty characters for validation here.',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });
    expect(created.version).toBe(1);

    const [a, b] = await Promise.allSettled([
      reserveBounty(created.id, CONTRIBUTOR),
      reserveBounty(created.id, OTHER_ACCOUNT),
    ]);

    const fulfilledResult = a.status === 'fulfilled' ? a : b;
    const rejectedResult = a.status === 'fulfilled' ? b : a;

    expect(fulfilledResult.status).toBe('fulfilled');
    expect(rejectedResult.status).toBe('rejected');

    if (fulfilledResult.status !== 'fulfilled' || rejectedResult.status !== 'rejected') {
      throw new Error('Expected exactly one fulfilled and one rejected reserve attempt');
    }

    expect(fulfilledResult.value.status).toBe('reserved');
    expect(fulfilledResult.value.version).toBe(2);

    // The losing attempt rejects as a typed conflict, never silently overwriting.
    const rejectedError = rejectedResult.reason as Error;
    expect(rejectedError.name).toBe('ConflictError');
    expect(rejectedError.message).toMatch(/only open bounties|locked by another request/i);

    // Persisted state matches the winner exactly.
    const persisted = readPersistedStore();
    expect(persisted[0].version).toBe(2);
    expect(persisted[0].status).toBe('reserved');
    expect(persisted[0].contributor).toBe(fulfilledResult.value.contributor);
  });
});

// ---------------------------------------------------------------------------
// Postgres-backed store coverage.
//
// Runs only when DATABASE_URL is configured (e.g. a local Postgres or the CI
// job that exercises the Postgres migration). Uses the `version` column from
// backend/prisma/schema.prisma for optimistic locking, plus a row-level
// `SELECT ... FOR UPDATE` alternative.
// ---------------------------------------------------------------------------
const POSTGRES_CONFIGURED = Boolean(process.env.DATABASE_URL);

describe.runIf(POSTGRES_CONFIGURED)(
  'concurrent reserveBounty requests — Postgres-backed store',
  () => {
    async function seedBounty() {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const now = Math.floor(Date.now() / 1000);
      const created = await prisma.bounty.create({
        data: {
          repo: 'owner/repo-name',
          issueNumber: 1,
          title: 'Concurrent Postgres reserve test bounty',
          summary: 'Summary with at least twenty characters for the schema.',
          maintainer: MAINTAINER,
          tokenSymbol: 'XLM',
          amount: 42.5,
          labels: ['bug'],
          status: 'open',
          createdAt: now,
          deadlineAt: now + 30 * 24 * 60 * 60,
          version: 1,
          events: [{ type: 'created', timestamp: now }],
        },
      });
      return { prisma, created };
    }

    it('version column: only one of two concurrent optimistic reserve updates wins', async () => {
      const { prisma, created } = await seedBounty();
      try {
        const [a, b] = await Promise.all([
          prisma.bounty.updateMany({
            where: { id: created.id, status: 'open', version: 1 },
            data: {
              status: 'reserved',
              version: 2,
              contributor: CONTRIBUTOR,
            },
          }),
          prisma.bounty.updateMany({
            where: { id: created.id, status: 'open', version: 1 },
            data: {
              status: 'reserved',
              version: 2,
              contributor: OTHER_ACCOUNT,
            },
          }),
        ]);

        // Exactly one row matched; the losing update affected 0 rows.
        expect([a.count, b.count].sort((x, y) => x - y)).toEqual([0, 1]);

        const final = await prisma.bounty.findUnique({
          where: { id: created.id },
        });
        expect(final?.status).toBe('reserved');
        expect(final?.version).toBe(2);
        expect([CONTRIBUTOR, OTHER_ACCOUNT]).toContain(final?.contributor);
      } finally {
        await prisma.$disconnect();
      }
    });

    it('row-level locking: SELECT ... FOR UPDATE serializes two concurrent reserves', async () => {
      const { prisma, created } = await seedBounty();
      try {
        const attempt = async (contributor: string) =>
          prisma.$transaction(async (tx) => {
            // Lock the row so a concurrent transaction blocks until we commit.
            const rows = await tx.$queryRaw<Array<{ status: string; version: number }>>`
              SELECT status, version FROM "Bounty" WHERE id = ${created.id} FOR UPDATE
            `;
            const row = rows[0];
            if (!row || row.status !== 'open') {
              return false;
            }
            const updated = await tx.bounty.updateMany({
              where: {
                id: created.id,
                status: 'open',
                version: row.version,
              },
              data: {
                status: 'reserved',
                version: row.version + 1,
                contributor,
              },
            });
            return updated.count === 1;
          });

        const [a, b] = await Promise.all([attempt(CONTRIBUTOR), attempt(OTHER_ACCOUNT)]);

        // The row lock serializes the transactions: exactly one reserves.
        expect([a, b].filter(Boolean)).toHaveLength(1);

        const final = await prisma.bounty.findUnique({
          where: { id: created.id },
        });
        expect(final?.status).toBe('reserved');
        expect(final?.version).toBe(2);
        expect([CONTRIBUTOR, OTHER_ACCOUNT]).toContain(final?.contributor);
      } finally {
        await prisma.$disconnect();
      }
    });
  }
);
