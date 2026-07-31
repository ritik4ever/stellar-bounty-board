import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-list-${randomUUID()}.json`);
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();

  const base = {
    repo: "owner/repo-name",
    issueNumber: 99,
    title: "Implement the feature for the dashboard UI",
    summary: "Add a clear contributor flow with validation and error handling for users.",
    labels: ["bug"],
    version: 1,
    events: [{ type: "created", timestamp: 1000 }],
  };
  fs.writeFileSync(
    storeFile,
    JSON.stringify([
      { ...base, id: "BNT-0001", maintainer: MAINTAINER, tokenSymbol: "XLM", amount: 10, status: "open", createdAt: 1000, deadlineAt: 4102444800 },
      { ...base, id: "BNT-0002", maintainer: OTHER_ACCOUNT, tokenSymbol: "USDC", amount: 30, status: "reserved", contributor: CONTRIBUTOR, createdAt: 2000, deadlineAt: 4102531200 },
      { ...base, id: "BNT-0003", maintainer: MAINTAINER, tokenSymbol: "XLM", amount: 20, status: "open", createdAt: 3000, deadlineAt: 4102617600 },
    ]),
    "utf8",
  );
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  fs.rmSync(storeFile, { force: true });
});

describe("bounty list filters and sorting", () => {
  it.each([
    ["amount", "asc"],
    ["amount", "desc"],
    ["deadline", "asc"],
    ["deadline", "desc"],
    ["createdAt", "asc"],
    ["createdAt", "desc"],
    ["status", "asc"],
    ["status", "desc"],
  ] as const)("sorts by %s %s", async (sort, order) => {
    const { listBounties } = await import("../src/services/bountyStore");
    const values = listBounties({ sort, order }).map((bounty) =>
      sort === "deadline" ? bounty.deadlineAt : bounty[sort],
    );
    const expected = [...values].sort((a, b) =>
      typeof a === "string" ? a.localeCompare(String(b)) : Number(a) - Number(b),
    );
    expect(values).toEqual(order === "asc" ? expected : expected.reverse());
  });

  it("filters by maintainer only", async () => {
    const { listBounties } = await import("../src/services/bountyStore");
    expect(listBounties({ maintainer: MAINTAINER }).every((bounty) => bounty.maintainer === MAINTAINER)).toBe(true);
  });

  it("combines maintainer, status, and tokenSymbol filters with AND logic", async () => {
    const { listBounties } = await import("../src/services/bountyStore");
    expect(listBounties({ maintainer: MAINTAINER, status: "open", tokenSymbol: "XLM" }).map((bounty) => bounty.id).sort()).toEqual(["BNT-0001", "BNT-0003"]);
  });

  it("returns no matches for maintainer filters", async () => {
    const { listBounties } = await import("../src/services/bountyStore");
    expect(listBounties({ maintainer: CONTRIBUTOR })).toEqual([]);
  });
});
