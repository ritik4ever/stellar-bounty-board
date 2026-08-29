import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-api-dispute-evidence-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = "test";
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

async function seedBounty(
  app: Express.Application,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const body = { ...validCreateBody, ...overrides };
  const res = await request(app).post("/api/bounties").send(body).expect(201);
  return res.body.data.id as string;
}

async function fullCycle(app: Express.Application): Promise<string> {
  const id = await seedBounty(app);
  await request(app)
    .post(`/api/bounties/${id}/reserve`)
    .send({ contributor: CONTRIBUTOR })
    .expect(200);
  await request(app)
    .post(`/api/bounties/${id}/submit`)
    .send({
      contributor: CONTRIBUTOR,
      submissionUrl: "https://github.com/owner/repo/pull/1",
    })
    .expect(200);
  await request(app)
    .post(`/api/bounties/${id}/dispute`)
    .send({ contributor: CONTRIBUTOR, reason: "Disputing work submission." })
    .expect(200);
  return id;
}

describe("POST /api/bounties/:id/disputes/evidence", () => {
  it("attaches external IPFS/URL link successfully for contributor", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/disputes/evidence`)
      .send({
        caller: CONTRIBUTOR,
        url: "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        description: "IPFS evidence log",
      })
      .expect(201);

    expect(res.body.data.evidence).toBeDefined();
    expect(res.body.data.evidence.url).toBe("ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco");
    expect(res.body.data.evidence.uploadedBy).toBe(CONTRIBUTOR);
    expect(res.body.data.evidence.type).toBe("ipfs");

    expect(res.body.data.bounty.disputeEvidence).toHaveLength(1);
    expect(res.body.data.bounty.disputeEvidence[0].url).toBe("ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco");
  });

  it("attaches direct file upload (base64) successfully for maintainer", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const sampleBase64 = Buffer.from("PDF test content for dispute evidence", "utf8").toString("base64");

    const res = await request(app)
      .post(`/api/bounties/${id}/disputes/evidence`)
      .send({
        caller: MAINTAINER,
        fileName: "maintainer_proof.pdf",
        contentType: "application/pdf",
        fileData: sampleBase64,
        description: "Maintainer review logs",
      })
      .expect(201);

    expect(res.body.data.evidence).toBeDefined();
    expect(res.body.data.evidence.fileName).toBe("maintainer_proof.pdf");
    expect(res.body.data.evidence.contentType).toBe("application/pdf");
    expect(res.body.data.evidence.uploadedBy).toBe(MAINTAINER);
    expect(res.body.data.evidence.type).toBe("file");
    expect(res.body.data.evidence.url).toMatch(/uploads\/disputes\/BNT-/);
  });

  it("rejects an oversized file upload", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    // Create a dummy payload larger than 5MB
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
    const largeBase64 = largeBuffer.toString("base64");

    const res = await request(app)
      .post(`/api/bounties/${id}/disputes/evidence`)
      .send({
        caller: CONTRIBUTOR,
        fileName: "large_file.png",
        contentType: "image/png",
        fileData: largeBase64,
      })
      .expect(400);

    expect(res.body.error).toMatch(/exceeds maximum allowed limit/i);
  });

  it("rejects a disallowed content-type", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const sampleBase64 = Buffer.from("echo 'evil'", "utf8").toString("base64");

    const res = await request(app)
      .post(`/api/bounties/${id}/disputes/evidence`)
      .send({
        caller: CONTRIBUTOR,
        fileName: "script.sh",
        contentType: "application/x-sh",
        fileData: sampleBase64,
      })
      .expect(400);

    expect(res.body.error).toMatch(/Disallowed file content-type/i);
  });

  it("rejects a caller who is neither maintainer nor contributor", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/disputes/evidence`)
      .send({
        caller: OTHER_ACCOUNT,
        url: "https://example.com/evidence.pdf",
      })
      .expect(403);

    expect(res.body.error).toMatch(/Only the bounty contributor or maintainer/i);
  });

  it("returns 404 for unknown bounty ID", async () => {
    const app = await getApp();

    const res = await request(app)
      .post("/api/bounties/BNT-9999/disputes/evidence")
      .send({
        caller: MAINTAINER,
        url: "https://example.com/evidence.pdf",
      })
      .expect(404);

    expect(res.body.error).toMatch(/Bounty not found/i);
  });

  it("works with alias endpoint POST /api/bounties/:id/dispute/evidence", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/dispute/evidence`)
      .send({
        caller: CONTRIBUTOR,
        url: "https://example.com/evidence_doc.pdf",
      })
      .expect(201);

    expect(res.body.data.evidence.url).toBe("https://example.com/evidence_doc.pdf");
  });
});
