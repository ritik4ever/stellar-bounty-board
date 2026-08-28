import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";
import * as notificationService from "../src/services/notificationService";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-badges-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = "test";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.BADGES_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    const auditStorePath = storeFile.replace(/\.json$/i, ".audit.json");
    fs.unlinkSync(auditStorePath);
  } catch {
    /* best-effort */
  }
  try {
    const badgeStorePath = storeFile.replace(/\.json$/i, ".badges.json");
    fs.unlinkSync(badgeStorePath);
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function seedAndReleaseBounty(
  app: Express.Application,
  contributor: string = CONTRIBUTOR,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const body = { ...validCreateBody, ...overrides };
  const createRes = await request(app).post("/api/bounties").send(body).expect(201);
  const id = createRes.body.data.id as string;

  await request(app)
    .post(`/api/bounties/${id}/reserve`)
    .send({ contributor })
    .expect(200);

  await request(app)
    .post(`/api/bounties/${id}/submit`)
    .send({
      contributor,
      submissionUrl: `https://github.com/${body.repo}/pull/${Math.floor(Math.random() * 1000) + 1}`,
    })
    .expect(200);

  await request(app)
    .post(`/api/bounties/${id}/release`)
    .send({ maintainer: body.maintainer })
    .expect(200);

  return id;
}

describe("Contributor Badges / Achievement System (#788)", () => {
  it("GET /api/contributors/:address/badges returns 400 for invalid address", async () => {
    const app = await getApp();
    const res = await request(app)
      .get("/api/contributors/not-a-valid-stellar-address/badges")
      .expect(400);

    expect(res.body.error).toMatch(/valid contributor address/i);
  });

  it("GET /api/contributors/:address/badges returns empty array when contributor has no badges", async () => {
    const app = await getApp();
    const res = await request(app)
      .get(`/api/contributors/${CONTRIBUTOR}/badges`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it("awards first-bounty-completed badge upon completing 1st bounty and sends notification", async () => {
    const app = await getApp();
    const notifService = await import("../src/services/notificationService");
    const sendNotificationSpy = vi.spyOn(notifService, "sendNotification");

    // Complete first bounty
    const bountyId = await seedAndReleaseBounty(app, CONTRIBUTOR, { amount: 50 });

    // Allow background notification promise to settle
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app)
      .get(`/api/contributors/${CONTRIBUTOR}/badges`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const firstBadge = res.body.data.find(
      (b: { badgeId: string }) => b.badgeId === "first-bounty-completed",
    );
    expect(firstBadge).toBeDefined();
    expect(firstBadge.name).toBe("First Bounty Completed");
    expect(firstBadge.contributor).toBe(CONTRIBUTOR);
    expect(firstBadge.awardedAt).toBeGreaterThan(0);
    expect(firstBadge.metadata.bountyId).toBe(bountyId);

    // Verify notification was dispatched
    expect(sendNotificationSpy).toHaveBeenCalledWith(
      expect.arrayContaining([{ role: "contributor", address: CONTRIBUTOR }]),
      "badge_earned",
      expect.objectContaining({
        badgeId: "first-bounty-completed",
        contributor: CONTRIBUTOR,
      }),
    );
  });

  it("does not award duplicate first-bounty-completed badge on second release", async () => {
    const app = await getApp();

    await seedAndReleaseBounty(app, CONTRIBUTOR, { amount: 50 });
    await seedAndReleaseBounty(app, CONTRIBUTOR, { amount: 75 });

    const res = await request(app)
      .get(`/api/contributors/${CONTRIBUTOR}/badges`)
      .expect(200);

    const firstBadges = res.body.data.filter(
      (b: { badgeId: string }) => b.badgeId === "first-bounty-completed",
    );
    expect(firstBadges).toHaveLength(1);
  });

  it("awards ten-bounties-completed badge upon reaching 10 completed bounties", async () => {
    const app = await getApp();

    // Seed and release 10 bounties
    for (let i = 0; i < 10; i++) {
      await seedAndReleaseBounty(app, CONTRIBUTOR, { amount: 10 + i });
    }

    const res = await request(app)
      .get(`/api/contributors/${CONTRIBUTOR}/badges`)
      .expect(200);

    const tenBadge = res.body.data.find(
      (b: { badgeId: string }) => b.badgeId === "ten-bounties-completed",
    );
    expect(tenBadge).toBeDefined();
    expect(tenBadge.name).toBe("10 Bounties Completed");
    expect(tenBadge.contributor).toBe(CONTRIBUTOR);
    expect(tenBadge.awardedAt).toBeGreaterThan(0);
  });

  it("awards top-earner-of-month badge to the contributor with highest monthly earnings", async () => {
    const app = await getApp();

    // Contributor 1 completes a bounty of 500 XLM
    await seedAndReleaseBounty(app, CONTRIBUTOR, { amount: 500 });
    // Contributor 2 completes a bounty of 100 XLM in the same month
    await seedAndReleaseBounty(app, OTHER_ACCOUNT, { amount: 100 });

    const res1 = await request(app)
      .get(`/api/contributors/${CONTRIBUTOR}/badges`)
      .expect(200);

    const topEarnerBadge = res1.body.data.find(
      (b: { badgeId: string }) => b.badgeId === "top-earner-of-month",
    );
    expect(topEarnerBadge).toBeDefined();
    expect(topEarnerBadge.name).toBe("Top Earner of the Month");
    expect(topEarnerBadge.contributor).toBe(CONTRIBUTOR);
    expect(topEarnerBadge.metadata.totalEarnings).toBe(500);

    // Contributor 2 should not have the top-earner-of-month badge for that month
    const res2 = await request(app)
      .get(`/api/contributors/${OTHER_ACCOUNT}/badges`)
      .expect(200);

    const c2TopBadge = res2.body.data.find(
      (b: { badgeId: string }) => b.badgeId === "top-earner-of-month",
    );
    expect(c2TopBadge).toBeUndefined();
  });
});
