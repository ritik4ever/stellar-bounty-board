import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTRIBUTOR, MAINTAINER } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `multi-token-release-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.TOKEN_ADDRESS_MAP;

  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* temp cleanup best-effort */
  }

  try {
    fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json"));
  } catch {
    /* temp cleanup best-effort */
  }
});

describe("multi-token release support", () => {
  it("creates, reserves, submits, and releases a USDC bounty with a configured token address", async () => {
    const usdcAddress = "CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
    process.env.TOKEN_ADDRESS_MAP = JSON.stringify({ USDC: usdcAddress });

    const { createBounty, reserveBounty, submitBounty, releaseBounty } = await import(
      "../src/services/bountyStore"
    );

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 99,
      title: "Pay this bounty in USDC",
      summary: "Verify that USDC bounties keep their configured token address through release.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 75,
      deadlineDays: 14,
      labels: [],
    });

    expect(created.tokenSymbol).toBe("USDC");
    expect(created.tokenAddress).toBe(usdcAddress);

    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/99");
    const released = await releaseBounty(created.id, MAINTAINER, "e".repeat(64));

    expect(released.status).toBe("released");
    expect(released.tokenSymbol).toBe("USDC");
    expect(released.tokenAddress).toBe(usdcAddress);
  });
});
