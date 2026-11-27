const fs = require("node:fs");
const path = require("node:path");

const {
  BASE_EPOCH_SECONDS,
  DAY_SECONDS,
  HOUR_SECONDS,
  MAINTAINER,
  CONTRIBUTOR_A,
  CONTRIBUTOR_B,
  BOUNTY_DEFS,
  RESERVATION_TIMEOUT_SECONDS,
  makeBountyId,
  fixtureCreatedAt,
  fixtureDeadlineAt,
} = require("./seed-inputs");

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

function makeBounty(index) {
  const def = BOUNTY_DEFS[index % BOUNTY_DEFS.length];
  const id = makeBountyId(index);
  const createdAt = fixtureCreatedAt(index);
  const deadlineAt = fixtureDeadlineAt(index);

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
    reservationTimeoutSeconds: RESERVATION_TIMEOUT_SECONDS,
  };

  switch (def.status) {
    case "open":
      return { ...base, status: "open", createdAt, deadlineAt, events };

    case "reserved": {
      const reservedAt = createdAt + HOUR_SECONDS;
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
      const reservedAt = createdAt + HOUR_SECONDS;
      const submittedAt = reservedAt + 2 * HOUR_SECONDS;
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

    case "disputed": {
      const reservedAt = createdAt + HOUR_SECONDS;
      const submittedAt = reservedAt + 2 * HOUR_SECONDS;
      const disputedAt = submittedAt + DAY_SECONDS;
      return {
        ...base,
        status: "disputed",
        createdAt,
        deadlineAt,
        contributor: CONTRIBUTOR_A,
        reservedAt,
        submittedAt,
        disputedAt,
        version: 4,
        submissionUrl: `https://github.com/${def.repo}/pull/${def.issueNumber}`,
        notes: "Maintainer disputed the submission; awaiting arbitration.",
        disputeReason:
          "Submitted work does not match the acceptance criteria in the issue.",
        events: [
          ...events,
          { type: "reserved", timestamp: reservedAt, actor: CONTRIBUTOR_A },
          { type: "submitted", timestamp: submittedAt, actor: CONTRIBUTOR_A },
          { type: "disputed", timestamp: disputedAt, actor: MAINTAINER },
        ],
      };
    }

    case "released": {
      const reservedAt = createdAt + HOUR_SECONDS;
      const submittedAt = reservedAt + 2 * HOUR_SECONDS;
      const releasedAt = submittedAt + DAY_SECONDS;
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
      const reservedAt = createdAt + HOUR_SECONDS;
      const refundedAt = reservedAt + DAY_SECONDS;
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
      const expiredAt = deadlineAt + 1;
      return {
        ...base,
        status: "expired",
        createdAt,
        deadlineAt,
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
  console.log(`Base epoch (unix seconds): ${BASE_EPOCH_SECONDS}`);
}

seed();
