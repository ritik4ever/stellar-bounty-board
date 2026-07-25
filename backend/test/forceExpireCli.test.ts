import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAINTAINER, CONTRIBUTOR } from "./fixtures";

const scriptPath = path.join(__dirname, "..", "scripts", "force-expire.ts");
const ADMIN_KEY = "test-admin-key-1234567890";
let adminKeyHash: string;

let storeFile: string;

beforeEach(async () => {
  adminKeyHash = await bcrypt.hash(ADMIN_KEY, 4);
  storeFile = path.join(os.tmpdir(), `force-expire-cli-${randomUUID()}.json`);
});

afterEach(() => {
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json"));
  } catch {
    /* best-effort */
  }
});

function seedReservedBounty(): void {
  const now = Math.floor(Date.now() / 1000);
  const bounty = {
    id: "BNT-0001",
    repo: "acme/widget",
    issueNumber: 1,
    title: "CLI smoke test bounty",
    summary: "A reserved bounty used to exercise the force-expire CLI end to end.",
    maintainer: MAINTAINER,
    tokenSymbol: "XLM",
    tokenAddress: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA",
    amount: 100,
    labels: [],
    status: "reserved",
    createdAt: now - 100000,
    deadlineAt: now + 5000000,
    reservedAt: now - 90000,
    reservationTimeoutSeconds: 604800,
    contributor: CONTRIBUTOR,
    version: 1,
    events: [{ type: "created", timestamp: now - 100000 }],
  };
  fs.writeFileSync(storeFile, JSON.stringify([bounty], null, 2));
}

function runCli(args: string[], env: Record<string, string | undefined>) {
  return spawnSync("npx", ["tsx", scriptPath, ...args], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: true,
  });
}

describe("force-expire CLI", () => {
  it("mutates the store and exits 0 given a valid admin key and --yes", async () => {
    seedReservedBounty();

    const result = runCli(["BNT-0001", "--key", ADMIN_KEY, "--actor", "ops-jane", "--yes"], {
      BOUNTY_STORE_PATH: storeFile,
      ADMIN_API_KEY_HASH: adminKeyHash,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Force-expired bounty BNT-0001/);

    const stored = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    expect(stored[0].status).toBe("open");
    expect(stored[0].contributor).toBeUndefined();
  }, 30000);

  it("refuses to run without --yes and does not mutate the store", async () => {
    seedReservedBounty();
    const before = fs.readFileSync(storeFile, "utf8");

    const result = runCli(["BNT-0001", "--key", ADMIN_KEY, "--actor", "ops-jane"], {
      BOUNTY_STORE_PATH: storeFile,
      ADMIN_API_KEY_HASH: adminKeyHash,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--yes/);
    expect(fs.readFileSync(storeFile, "utf8")).toBe(before);
  }, 30000);

  it("rejects an invalid admin key and does not mutate the store", async () => {
    seedReservedBounty();
    const before = fs.readFileSync(storeFile, "utf8");

    const result = runCli(["BNT-0001", "--key", "wrong-key", "--actor", "ops-jane", "--yes"], {
      BOUNTY_STORE_PATH: storeFile,
      ADMIN_API_KEY_HASH: adminKeyHash,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Invalid admin key/);
    expect(fs.readFileSync(storeFile, "utf8")).toBe(before);
  }, 30000);

  it("refuses to run when ADMIN_API_KEY_HASH is not configured", async () => {
    seedReservedBounty();
    const before = fs.readFileSync(storeFile, "utf8");

    const result = runCli(["BNT-0001", "--key", ADMIN_KEY, "--actor", "ops-jane", "--yes"], {
      BOUNTY_STORE_PATH: storeFile,
      ADMIN_API_KEY_HASH: undefined,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ADMIN_API_KEY_HASH is not set/);
    expect(fs.readFileSync(storeFile, "utf8")).toBe(before);
  }, 30000);
});
