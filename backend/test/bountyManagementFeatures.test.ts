import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-features-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  for (const file of [storeFile, storeFile.replace(/\.json$/, ".audit.json"), storeFile.replace(/\.json$/, ".templates.json"), storeFile.replace(/\.json$/, ".schedules.json")]) {
    try { fs.unlinkSync(file); } catch { /* best effort */ }
  }
});

async function getApp() {
  return (await import("../src/app")).app;
}

describe("dedicated bounty search", () => {
  it("searches title, summary, and repo with title matches ranked first and pagination metadata", async () => {
    const app = await getApp();
    await request(app).post("/api/bounties").send({ ...validCreateBody, title: "Wallet search feature" }).expect(201);
    await request(app).post("/api/bounties").send({ ...validCreateBody, issueNumber: 100, repo: "wallet/tools", title: "Unrelated feature" }).expect(201);
    const response = await request(app).get("/api/bounties/search").query({ q: "wallet", page: 1, pageSize: 1 }).expect(200);
    expect(response.body.total).toBe(2);
    expect(response.body.hasMore).toBe(true);
    expect(response.body.data[0].title).toBe("Wallet search feature");
    await request(app).get("/api/bounties/search").query({ q: "" }).expect(200).expect(({ body }) => expect(body.data).toEqual([]));
  });
});

describe("bounty templates", () => {
  it("seeds presets and applies defaults while preserving explicit overrides", async () => {
    const app = await getApp();
    const templates = await request(app).get("/api/bounty-templates").expect(200);
    expect(templates.body.data.some((item: { id: string }) => item.id === "small-bug-fix")).toBe(true);
    const created = await request(app).post("/api/bounties").send({
      repo: validCreateBody.repo,
      issueNumber: 101,
      title: validCreateBody.title,
      summary: validCreateBody.summary,
      maintainer: MAINTAINER,
      templateId: "small-bug-fix",
      amount: 33,
    }).expect(201);
    expect(created.body.data.amount).toBe(33);
    expect(created.body.data.deadlineAt - created.body.data.createdAt).toBe(7 * 86_400);
    expect(created.body.data.labels).toEqual(["bug"]);
  });
});

describe("CSV bounty import", () => {
  it("creates valid rows and reports invalid rows independently", async () => {
    const app = await getApp();
    const header = "repo,issueNumber,title,summary,maintainer,tokenSymbol,amount,deadlineDays,labels";
    const valid = `owner/repo,201,Valid imported bounty,This imported bounty has a sufficiently long summary,${MAINTAINER},XLM,50,14,bug|backend`;
    const invalid = `not-a-repo,202,Bad,short,${MAINTAINER},XLM,-1,0,bug`;
    const response = await request(app).post("/api/bounties/import").set("Content-Type", "text/csv").send(`${header}\n${valid}\n${invalid}\n`).expect(201);
    expect(response.body).toMatchObject({ created: 1, failed: 1, total: 2 });
    expect(response.body.data[1].row).toBe(3);
    expect(response.body.data[1].errors.length).toBeGreaterThan(0);
  });

  it("rejects an unauthenticated caller outside the test auth bypass", async () => {
    const app = await getApp();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.ADMIN_API_KEY_HASH = bcrypt.hashSync("import-secret", 4);
    try {
      await request(app).post("/api/bounties/import").set("Content-Type", "text/csv").send("repo\nowner/repo\n").expect(401);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      delete process.env.ADMIN_API_KEY_HASH;
    }
  });
});

describe("recurring bounty schedules", () => {
  it("creates exactly one bounty when due and cancellation prevents later runs", async () => {
    const { createRecurringSchedule, cancelRecurringSchedule, runDueRecurringSchedules } = await import("../src/services/recurringBountySchedules");
    const now = Math.floor(Date.now() / 1000);
    const schedule = createRecurringSchedule({
      cadence: "weekly",
      templateId: "small-bug-fix",
      targetRepo: "owner/repo",
      bounty: {
        issueNumber: 301,
        title: validCreateBody.title,
        summary: validCreateBody.summary,
        maintainer: MAINTAINER,
        tokenSymbol: "XLM",
        amount: 25,
        deadlineDays: 7,
        labels: ["bug"],
      },
      startAt: now,
    });
    expect(await runDueRecurringSchedules(now)).toHaveLength(1);
    expect(await runDueRecurringSchedules(now)).toHaveLength(0);
    cancelRecurringSchedule(schedule.id);
    expect(await runDueRecurringSchedules(now + 2 * 604_800)).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(storeFile, "utf8"))).toHaveLength(1);
  });
});
