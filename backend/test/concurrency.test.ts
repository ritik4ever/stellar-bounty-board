import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { CONTRIBUTOR, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-concurrency-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  // Clear require cache to ensure fresh state for each test
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
    const auditStorePath = storeFile.replace(/\.json$/i, ".audit.json");
    fs.unlinkSync(auditStorePath);
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

describe("Bounty Reservation Concurrency", () => {
  it("should only allow one successful reservation when 20 requests are simultaneous", async () => {
    const app = await getApp();
    
    // Increase timeout for concurrent lock contention
    vi.setConfig({ testTimeout: 60000 });
    
    // 1. Create a bounty
    const createRes = await request(app)
      .post("/api/bounties")
      .send(validCreateBody)
      .expect(201);
    
    const id = createRes.body.data.id;

    // 2. Fire 20 simultaneous reserve requests
    // We use Promise.all to fire them as close together as possible
    // Use the valid CONTRIBUTOR address from fixtures for all requests
    // Only one will succeed, the rest will fail with 400 (bounty already reserved)
    const contributors = Array.from({ length: 20 }, () => CONTRIBUTOR);
    const requests = contributors.map(contributor =>
      request(app)
        .post(`/api/bounties/${id}/reserve`)
        .send({ contributor })
    );

    const responses = await Promise.all(requests);

    // 3. Assert exactly one success
    const statuses = responses.map(r => r.status);
    const successes = statuses.filter(s => s === 200).length;
    const failures = statuses.filter(s => s === 409 || s === 400).length;
    
    // Debug: log response bodies for first few failures
    if (successes !== 1) {
      const sampleErrors = responses
        .filter(r => r.status !== 200)
        .slice(0, 3)
        .map(r => ({ status: r.status, body: r.body }));
      console.log('Sample error responses:', JSON.stringify(sampleErrors, null, 2));
    }

    expect(successes, `Expected exactly one 200 response, but got ${successes}. Statuses: ${JSON.stringify(statuses)}`).toBe(1);
    expect(failures, `Expected 19 error responses (400 or 409), but got ${failures}. Statuses: ${JSON.stringify(statuses)}`).toBe(19);

    // 4. Verify the state in the store
    const getRes = await request(app).get(`/api/bounties/${id}`).expect(200);
    expect(getRes.body.data.status).toBe("reserved");
    // Only one contributor should be recorded
    const contributor = getRes.body.data.contributor;
    expect(contributors).toContain(contributor);
  });
});
