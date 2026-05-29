import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bounty-store-validation-"));
  tempRoots.push(root);
  return root;
}

async function loadValidator() {
  vi.resetModules();
  return import("../src/services/bountyStore");
}

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.BOUNTY_AUDIT_STORE_PATH;
  vi.restoreAllMocks();

  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("bounty store path startup validation", () => {
  it("accepts an existing writable store path", async () => {
    const root = makeTempRoot();
    const storePath = path.join(root, "bounties.json");
    fs.writeFileSync(storePath, "[]", "utf8");
    process.env.BOUNTY_STORE_PATH = storePath;

    const { validateBountyStorePath } = await loadValidator();

    expect(() => validateBountyStorePath()).not.toThrow();
    expect(fs.existsSync(storePath)).toBe(true);
  });

  it("creates a missing store directory before startup continues", async () => {
    const root = makeTempRoot();
    const storePath = path.join(root, "nested", "store", "bounties.json");
    process.env.BOUNTY_STORE_PATH = storePath;

    const { validateBountyStorePath } = await loadValidator();

    expect(() => validateBountyStorePath()).not.toThrow();
    expect(fs.existsSync(path.dirname(storePath))).toBe(true);
    expect(fs.existsSync(storePath)).toBe(true);
  });

  it("logs a fatal startup error and exits when the path cannot be written", async () => {
    const root = makeTempRoot();
    const blockedParent = path.join(root, "not-a-directory");
    fs.writeFileSync(blockedParent, "blocks nested paths", "utf8");
    process.env.BOUNTY_STORE_PATH = path.join(blockedParent, "bounties.json");
    const exit = vi.fn((code: number): never => {
      throw new Error(`exit:${code}`);
    });

    const { validateBountyStorePath } = await loadValidator();

    expect(() => validateBountyStorePath({ exit })).toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs a fatal startup error and exits when the audit store path cannot be written", async () => {
    const root = makeTempRoot();
    process.env.BOUNTY_STORE_PATH = path.join(root, "bounties.json");
    const blockedParent = path.join(root, "not-a-directory");
    fs.writeFileSync(blockedParent, "blocks nested paths", "utf8");
    process.env.BOUNTY_AUDIT_STORE_PATH = path.join(blockedParent, "bounties.audit.json");
    const exit = vi.fn((code: number): never => {
      throw new Error(`exit:${code}`);
    });

    const { validateBountyStorePath } = await loadValidator();

    expect(() => validateBountyStorePath({ exit })).toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
  });
});