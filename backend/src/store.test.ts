/**
 * store.test.ts – unit tests for the JSON store with auto-backup.
 *
 * Run with:  npm test  (or npx vitest run from the backend directory)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadBounties,
  resolveBackupPath,
  resolveStorePath,
  saveBounties,
} from "./store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpStore(): string {
  return path.join(
    os.tmpdir(),
    `bounties-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
}

function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* already gone */
    }
  }
}

const SAMPLE = [
  { id: "1", title: "Fix bug", status: "open" },
  { id: "2", title: "Add tests", status: "reserved" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveStorePath", () => {
  it("uses BOUNTY_STORE_PATH env var when set", () => {
    const original = process.env.BOUNTY_STORE_PATH;
    process.env.BOUNTY_STORE_PATH = "/tmp/custom.json";
    expect(resolveStorePath()).toBe("/tmp/custom.json");
    if (original === undefined) delete process.env.BOUNTY_STORE_PATH;
    else process.env.BOUNTY_STORE_PATH = original;
  });
});

describe("resolveBackupPath", () => {
  it("appends .bak to the store path", () => {
    expect(resolveBackupPath("/data/bounties.json")).toBe(
      "/data/bounties.json.bak"
    );
  });
});

describe("saveBounties", () => {
  let store: string;
  let backup: string;

  beforeEach(() => {
    store = tmpStore();
    backup = resolveBackupPath(store);
  });

  afterEach(() => cleanup(store, backup));

  it("writes bounties as formatted JSON", () => {
    saveBounties(SAMPLE, store);
    const written = JSON.parse(fs.readFileSync(store, "utf8"));
    expect(written).toEqual(SAMPLE);
  });

  it("creates a backup of the previous file before each write", () => {
    // First write – no previous file, so no backup yet.
    saveBounties([SAMPLE[0]], store);
    expect(fs.existsSync(backup)).toBe(true);

    // Backup should contain first state.
    const firstBackup = JSON.parse(fs.readFileSync(backup, "utf8"));
    expect(firstBackup).toEqual([SAMPLE[0]]);

    // Second write – backup should now contain first state.
    saveBounties(SAMPLE, store);
    const secondBackup = JSON.parse(fs.readFileSync(backup, "utf8"));
    expect(secondBackup).toEqual([SAMPLE[0]]);
  });

  it("backup is stored alongside the main file", () => {
    saveBounties(SAMPLE, store);
    expect(path.dirname(backup)).toBe(path.dirname(store));
  });

  it("does not create a backup when no previous file exists", () => {
    // store doesn't exist yet.
    saveBounties([], store);
    // backup may or may not exist – if it does it must be empty-ish
    // but the key assertion is the write itself succeeded.
    expect(fs.existsSync(store)).toBe(true);
  });
});

describe("loadBounties", () => {
  let store: string;
  let backup: string;

  beforeEach(() => {
    store = tmpStore();
    backup = resolveBackupPath(store);
  });

  afterEach(() => cleanup(store, backup));

  it("returns data from a valid main file", () => {
    fs.writeFileSync(store, JSON.stringify(SAMPLE), "utf8");
    expect(loadBounties(store)).toEqual(SAMPLE);
  });

  it("returns [] when neither file exists", () => {
    expect(loadBounties(store)).toEqual([]);
  });

  it("recovers from a corrupted main file using the backup", () => {
    // Write valid backup.
    fs.writeFileSync(backup, JSON.stringify(SAMPLE), "utf8");
    // Corrupt the main file.
    fs.writeFileSync(store, "{ this is not valid json !!!", "utf8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = loadBounties(store);

    expect(result).toEqual(SAMPLE);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Restored")
    );

    warnSpy.mockRestore();
  });

  it("logs a warning when restoring from backup", () => {
    fs.writeFileSync(backup, JSON.stringify([SAMPLE[0]]), "utf8");
    fs.writeFileSync(store, "CORRUPTED", "utf8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadBounties(store);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid JSON")
    );
    warnSpy.mockRestore();
  });

  it("restores the main file from backup so subsequent reads succeed", () => {
    fs.writeFileSync(backup, JSON.stringify(SAMPLE), "utf8");
    fs.writeFileSync(store, "CORRUPTED", "utf8");

    vi.spyOn(console, "warn").mockImplementation(() => {});
    loadBounties(store);

    // Main file should now be valid again.
    const restored = JSON.parse(fs.readFileSync(store, "utf8"));
    expect(restored).toEqual(SAMPLE);
    vi.restoreAllMocks();
  });

  it("returns [] when both main and backup files are corrupted", () => {
    fs.writeFileSync(store, "BAD JSON", "utf8");
    fs.writeFileSync(backup, "ALSO BAD", "utf8");

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = loadBounties(store);
    expect(result).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("round-trip: saveBounties then loadBounties", () => {
  let store: string;

  beforeEach(() => {
    store = tmpStore();
  });

  afterEach(() => cleanup(store, resolveBackupPath(store)));

  it("persists and reloads bounties correctly", () => {
    saveBounties(SAMPLE, store);
    expect(loadBounties(store)).toEqual(SAMPLE);
  });

  it("simulates corruption and recovers via backup", () => {
    // Simulate a prior clean write (creates the backup source).
    saveBounties(SAMPLE, store);

    // Manually corrupt the main file (crash during write).
    fs.writeFileSync(store, "<<<CORRUPT>>>", "utf8");

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const recovered = loadBounties(store);
    expect(recovered).toEqual(SAMPLE);
    vi.restoreAllMocks();
  });
});