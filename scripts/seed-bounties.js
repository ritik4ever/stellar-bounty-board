const fs = require("node:fs");
const path = require("node:path");

const STORE_PATH = path.resolve(__dirname, "../backend/data/bounties.json");
const AUDIT_PATH = path.resolve(
  __dirname,
  "../backend/data/bounties.audit.json",
);

const args = process.argv.slice(2);
const countFlag = args.indexOf("--count");
const COUNT =
  countFlag !== -1 ? Math.max(1, Number(args[countFlag + 1]) || 10) : 10;
const RESET = args.includes("--reset");

const MAINTAINER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CONTRIBUTOR_A =
  "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const CONTRIBUTOR_B =
  "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

const BOUNTY_DEFS = [
  {
    title: "Implement wallet connection UI",
    summary:
      "Add Stellar wallet connection flow using Freighter and wallet SDK integration for user authentication.",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 101,
    token: "XLM",
    amount: 200,
    labels: ["frontend", "help wanted"],
    status: "open",
    deadlineDays: 30,
  },
  {
    title: "Add dark mode support",
    summary:
      "Implement system-aware dark mode toggle with persistent user preference saved to local storage.",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 102,
    token: "XLM",
    amount: 150,
    labels: ["frontend", "ui"],
    status: "open",
    deadlineDays: 14,
  },
  {
    title: "Build REST API for bounties",
    summary:
      "Create Express REST endpoints for bounty CRUD with Zod validation and OpenAPI documentation.",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 103,
    token: "XLM",
    amount: 300,
    labels: ["backend", "api"],
    status: "reserved",
    deadlineDays: 21,
  },
  {
    title: "Write integration tests",
    summary:
      "Add Vitest integration tests covering bounty lifecycle: create, reserve, submit, release, refund.",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 104,
    token: "USDC",
    amount: 180,
    labels: ["testing", "help wanted"],
    status: "submitted",
    deadlineDays: 14,
  },
  {
    title: "Fix pagination bug",
    summary:
      "Bounty list pagination returns duplicate entries when sorting by creation date. Fix offset calculation.",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 55,
    token: "XLM",
    amount: 100,
    labels: ["bug", "backend"],
    status: "released",
    deadlineDays: 7,
  },
  {
    title: "Add search functionality",
    summary:
      "Implement full-text search across bounty titles, summaries, and labels with debounced input.",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 56,
    token: "XLM",
    amount: 250,
    labels: ["feature", "frontend"],
    status: "released",
    deadlineDays: 30,
  },
  {
    title: "Refactor auth middleware",
    summary:
      "Extract Stellar address validation into reusable middleware with proper error handling and tests.",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 107,
    token: "XLM",
    amount: 120,
    labels: ["refactor", "backend"],
    status: "refunded",
    deadlineDays: 10,
  },
  {
    title: "Update npm dependencies",
    summary:
      "Audit and update all outdated npm packages across backend and frontend, resolving breaking changes.",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 108,
    token: "USDC",
    amount: 80,
    labels: ["chore", "dependencies"],
    status: "refunded",
    deadlineDays: 7,
  },
  {
    title: "Add CSV export feature",
    summary:
      "Export bounty list to CSV with configurable columns and date-range filter for maintainers.",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 59,
    token: "XLM",
    amount: 160,
    labels: ["feature", "analytics"],
    status: "expired",
    deadlineDays: 7,
  },
  {
    title: "Create notification system",
    summary:
      "Build WebSocket-based notification system for bounty status changes using Server-Sent Events.",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 60,
    token: "XLM",
    amount: 350,
    labels: ["feature", "realtime"],
    status: "expired",
    deadlineDays: 14,
  },
];

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function makeBounty(index) {
  const def = BOUNTY_DEFS[index % BOUNTY_DEFS.length];
  const id = `BNT-${String(1001 + index).padStart(4, "0")}`;
  const createdAt = nowSeconds() - (BOUNTY_DEFS.length - index) * 86400;
  const deadlineAt = createdAt + def.deadlineDays * 86400;

  const events = [{ type: "created", timestamp: createdAt }];
  const base = {
    id,
    repo: def.repo,
    issueNumber: def.issueNumber,
    title: def.title,
    summary: def.summary,
    maintainer: MAINTAINER,
    tokenSymbol: def.token,
    amount: def.amount,
    labels: def.labels,
    version: 1,
    reservationTimeoutSeconds: 604800,
  };

  switch (def.status) {
    case "open":
      return { ...base, status: "open", createdAt, deadlineAt, events };

    case "reserved": {
      const reservedAt = createdAt + 3600;
      return {
        ...base,
        status: "reserved",
        createdAt,
        deadlineAt,
        contributor: CONTRIBUTOR_A,
        reservedAt,
        version: 2,
        events: [
          ...events,
          { type: "reserved", timestamp: reservedAt, actor: CONTRIBUTOR_A },
        ],
      };
    }

    case "submitted": {
      const reservedAt = createdAt + 3600;
      const submittedAt = reservedAt + 7200;
      return {
        ...base,
        status: "submitted",
        createdAt,
        deadlineAt,
        contributor: CONTRIBUTOR_A,
        reservedAt,
        submittedAt,
        version: 3,
        submissionUrl:
          "https://github.com/ritik4ever/stellar-bounty-board/pull/42",
        notes: "Ready for review. All tests pass.",
        events: [
          ...events,
          { type: "reserved", timestamp: reservedAt, actor: CONTRIBUTOR_A },
          { type: "submitted", timestamp: submittedAt, actor: CONTRIBUTOR_A },
        ],
      };
    }

    case "released": {
      const reservedAt = createdAt + 3600;
      const submittedAt = reservedAt + 7200;
      const releasedAt = submittedAt + 86400;
      return {
        ...base,
        status: "released",
        createdAt,
        deadlineAt,
        contributor: CONTRIBUTOR_B,
        reservedAt,
        submittedAt,
        releasedAt,
        version: 4,
        releasedTxHash: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
        submissionUrl: `https://github.com/${def.repo}/pull/${def.issueNumber}`,
        events: [
          ...events,
          { type: "reserved", timestamp: reservedAt, actor: CONTRIBUTOR_B },
          { type: "submitted", timestamp: submittedAt, actor: CONTRIBUTOR_B },
          { type: "released", timestamp: releasedAt, actor: MAINTAINER },
        ],
      };
    }

    case "refunded": {
      const reservedAt = createdAt + 3600;
      const refundedAt = reservedAt + 86400;
      return {
        ...base,
        status: "refunded",
        createdAt,
        deadlineAt,
        contributor: CONTRIBUTOR_A,
        reservedAt,
        refundedAt,
        version: 3,
        refundedTxHash: "z9y8x7w6v5u4t3s2r1q0p9o8i7u6y5t4r3e2w1q",
        events: [
          ...events,
          { type: "reserved", timestamp: reservedAt, actor: CONTRIBUTOR_A },
          { type: "refunded", timestamp: refundedAt, actor: MAINTAINER },
        ],
      };
    }

    case "expired": {
      const deadlinePast = createdAt + def.deadlineDays * 86400;
      const expiredAt = deadlinePast + 1;
      return {
        ...base,
        status: "expired",
        createdAt,
        deadlineAt: deadlinePast,
        events: [...events, { type: "expired", timestamp: expiredAt }],
      };
    }

    default:
      return { ...base, status: "open", createdAt, deadlineAt, events };
  }
}

function seed() {
  const dataDir = path.dirname(STORE_PATH);
  fs.mkdirSync(dataDir, { recursive: true });

  const storeExists = fs.existsSync(STORE_PATH);
  const hasData =
    storeExists && fs.readFileSync(STORE_PATH, "utf8").trim().length > 2;

  if (hasData && !RESET) {
    console.error("Store already has data. Use --reset to wipe and re-seed.");
    process.exit(1);
  }

  if (RESET) {
    fs.writeFileSync(STORE_PATH, JSON.stringify([], null, 2));
    fs.writeFileSync(AUDIT_PATH, JSON.stringify([], null, 2));
    console.log("Store wiped.");
  }

  const bounties = Array.from({ length: COUNT }, (_, i) => makeBounty(i));
  fs.writeFileSync(STORE_PATH, JSON.stringify(bounties, null, 2));

  const statusCounts = {};
  for (const b of bounties) {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  }

  console.log(`Seeded ${bounties.length} bounties:`);
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }
}

seed();
