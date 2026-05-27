import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { validCreateBody, CONTRIBUTOR, MAINTAINER } from "./fixtures";
import { signWebhookPayload, githubWebhookSignatureProfile } from "../src/webhooks/signatureVerification";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

const secret = "github-webhook-secret";

function createGitHubSignature(payload: Buffer): string {
  return signWebhookPayload({
    payload,
    secret,
    algorithm: githubWebhookSignatureProfile.algorithm,
    prefix: githubWebhookSignatureProfile.prefix,
  });
}

let storeFile: string;

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function getStoreStore() {
  const mod = await import("../src/services/bountyStore");
  return mod;
}

describe("GitHub webhook PR auto-release", () => {
  beforeEach(async () => {
    storeFile = path.join(os.tmpdir(), `bounty-webhook-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, "[]", "utf8");
    process.env.BOUNTY_STORE_PATH = storeFile;
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.BOUNTY_STORE_PATH;
    try {
      fs.unlinkSync(storeFile);
    } catch {}
    try {
      fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json"));
    } catch {}
  });

  const validPrPayload = (html_url: string, merged = true, action = "closed") => ({
    action,
    pull_request: {
      html_url,
      merged,
    },
  });

  it("Merged PR triggers bounty release automatically", async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStoreStore();
    const app = await getApp();
    const prUrl = "https://github.com/owner/repo-name/pull/100";
    
    // Create, reserve, submit
    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    let saved = listBounties().find(b => b.id === bounty.id);
    expect(saved?.status).toBe("submitted");

    const payload = validPrPayload(prUrl, true, "closed");
    const rawPayload = JSON.stringify(payload);
    const signature = createGitHubSignature(Buffer.from(rawPayload, "utf8"));

    await request(app)
      .post("/api/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(rawPayload)
      .expect(202);

    saved = listBounties().find(b => b.id === bounty.id);
    expect(saved?.status).toBe("released");
  });

  it("Closed-but-not-merged PR does not trigger release", async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStoreStore();
    const app = await getApp();
    const prUrl = "https://github.com/owner/repo-name/pull/101";
    
    // Create, reserve, submit
    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const payload = validPrPayload(prUrl, false, "closed");
    const rawPayload = JSON.stringify(payload);
    const signature = createGitHubSignature(Buffer.from(rawPayload, "utf8"));

    await request(app)
      .post("/api/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(rawPayload)
      .expect(202);

    // Should remain submitted
    const saved = listBounties().find(b => b.id === bounty.id);
    expect(saved?.status).toBe("submitted");
  });

  it("Bounty without matching PR URL is ignored gracefully", async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStoreStore();
    const app = await getApp();
    const prUrl = "https://github.com/owner/repo-name/pull/102";
    const differentPrUrl = "https://github.com/owner/repo-name/pull/999";
    
    // Create, reserve, submit
    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    // Send webhook with different URL
    const payload = validPrPayload(differentPrUrl, true, "closed");
    const rawPayload = JSON.stringify(payload);
    const signature = createGitHubSignature(Buffer.from(rawPayload, "utf8"));

    await request(app)
      .post("/api/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(rawPayload)
      .expect(202);

    const saved = listBounties().find(b => b.id === bounty.id);
    expect(saved?.status).toBe("submitted");
  });

  it("Manual release still works if webhook was not received", async () => {
    const { createBounty, reserveBounty, submitBounty } = await getStoreStore();
    const app = await getApp();
    const prUrl = "https://github.com/owner/repo-name/pull/103";
    
    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const rel = await request(app)
      .post(`/api/bounties/${bounty.id}/release`)
      .send({ maintainer: MAINTAINER, transactionHash: "a".repeat(64) })
      .expect(200);
      
    expect(rel.body.data.status).toBe("released");
  });
});
