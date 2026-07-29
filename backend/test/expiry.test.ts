import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BountyRecord } from "../src/services/bountyStore";
import { MAINTAINER } from "./fixtures";

let storeFile: string;
const now = Math.floor(Date.now() / 1000);

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-expiry-${randomUUID()}.json`);
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
});

describe("expiration on read", () => {
  it("marks an open bounty past its deadline as expired when listed", async () => {
    const record: BountyRecord = {
      id: "BNT-0001",
      repo: "owner/repo",
      issueNumber: 1,
      title: "Overdue bounty",
      summary: "A bounty whose deadline has already passed.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      tokenAddress: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA",
      amount: 10,
      labels: [],
      status: "open",
      createdAt: now - 1000,
      deadlineAt: now - 1,
      version: 1,
      events: [{ type: "created", timestamp: now - 1000 }],
    };
    fs.writeFileSync(storeFile, JSON.stringify([record]), "utf8");
    process.env.BOUNTY_STORE_PATH = storeFile;

    const { listBounties } = await import("../src/services/bountyStore");
    const [bounty] = listBounties();

    expect(bounty.status).toBe("expired");
  });
});
