#!/usr/bin/env node
/**
 * Demo seed script for Stellar Bounty Board.
 *
 * Distinct from the throughput-oriented load-test seeder:
 * seeds a curated, varied showcase dataset covering every lifecycle state
 * (open, reserved, submitted, released, refunded, expired) with realistic
 * details for UI and product demonstrations.
 *
 * Usage:
 *   npm run seed:demo
 *   npm run seed:demo -- --reset
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STORE_PATH = path.resolve(__dirname, "../backend/data/bounties.json");
const AUDIT_PATH = path.resolve(
  __dirname,
  "../backend/data/bounties.audit.json",
);

const args = process.argv.slice(2);
const RESET = args.includes("--reset");

const MAINTAINER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CONTRIBUTOR_ALICE =
  "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const CONTRIBUTOR_BOB =
  "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const CONTRIBUTOR_CAROL =
  "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

// Curated demo bounties covering each distinct lifecycle state
const DEMO_BOUNTIES_SPEC = [
  {
    status: "open",
    id: "DEMO-0001",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 101,
    title: "Implement Freighter wallet connection flow",
    summary:
      "Integrate Freighter wallet adapter with clean error handling and reconnect recovery for contributors.",
    tokenSymbol: "XLM",
    amount: 250,
    labels: ["frontend", "wallet", "good first issue"],
    deadlineDays: 20,
    offsetDays: 3,
  },
  {
    status: "open",
    id: "DEMO-0002",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 102,
    title: "Support dark mode with system theme sync",
    summary:
      "Add theme toggle component supporting light, dark, and system preference with persistent local storage.",
    tokenSymbol: "USDC",
    amount: 150,
    labels: ["frontend", "ui", "enhancement"],
    deadlineDays: 14,
    offsetDays: 2,
  },
  {
    status: "reserved",
    id: "DEMO-0003",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 103,
    title: "Build REST API rate limiter using Redis store",
    summary:
      "Replace in-memory rate limiter with Redis-backed token bucket to support multi-instance horizontal scaling.",
    tokenSymbol: "XLM",
    amount: 300,
    labels: ["backend", "redis", "security"],
    deadlineDays: 21,
    offsetDays: 4,
    contributor: CONTRIBUTOR_ALICE,
  },
  {
    status: "submitted",
    id: "DEMO-0004",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 104,
    title: "End-to-end integration tests for dispute flow",
    summary:
      "Add Vitest integration test suite simulating maintainer dispute resolution via on-chain arbiter call.",
    tokenSymbol: "USDC",
    amount: 400,
    labels: ["testing", "backend", "arbitration"],
    deadlineDays: 14,
    offsetDays: 6,
    contributor: CONTRIBUTOR_BOB,
    submissionUrl:
      "https://github.com/ritik4ever/stellar-bounty-board/pull/1540",
    notes:
      "Implemented comprehensive tests covering happy path and edge cases. Vitest runs clean with 100% coverage.",
  },
  {
    status: "released",
    id: "DEMO-0005",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 55,
    title: "Optimize Soroban event indexing query performance",
    summary:
      "Index event topics and batch RPC poll queries, reducing worker latency by 45%.",
    tokenSymbol: "XLM",
    amount: 500,
    labels: ["performance", "contracts", "worker"],
    deadlineDays: 10,
    offsetDays: 12,
    contributor: CONTRIBUTOR_CAROL,
    submissionUrl: "https://github.com/ritik4ever/stellar-stream/pull/55",
    releasedTxHash:
      "3f7a1b9c8d5e4f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a",
  },
  {
    status: "refunded",
    id: "DEMO-0006",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 107,
    title: "Implement legacy v1 RPC fallback client",
    summary:
      "Add backwards-compatible RPC client fallback for legacy Horizon deployments.",
    tokenSymbol: "XLM",
    amount: 180,
    labels: ["backend", "deprecated"],
    deadlineDays: 7,
    offsetDays: 15,
    contributor: CONTRIBUTOR_ALICE,
    refundedTxHash:
      "e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7",
  },
  {
    status: "expired",
    id: "DEMO-0007",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 59,
    title: "Draft protocol v0.8 migration guide",
    summary:
      "Technical walkthrough detailing breaking changes and contract upgrade paths for protocol v0.8.",
    tokenSymbol: "USDC",
    amount: 120,
    labels: ["docs", "protocol"],
    deadlineDays: 5,
    offsetDays: 20,
  },
];

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function buildDemoBounties() {
  const now = nowSeconds();

  return DEMO_BOUNTIES_SPEC.map((spec) => {
    const createdAt = now - spec.offsetDays * 86400;
    const deadlineAt = spec.status === "expired"
      ? createdAt + spec.deadlineDays * 86400
      : createdAt + spec.deadlineDays * 86400;

    const events = [{ type: "created", timestamp: createdAt }];

    const base = {
      id: spec.id,
      repo: spec.repo,
      issueNumber: spec.issueNumber,
      title: spec.title,
      summary: spec.summary,
      maintainer: MAINTAINER,
      tokenSymbol: spec.tokenSymbol,
      amount: spec.amount,
      labels: spec.labels,
      version: 1,
      reservationTimeoutSeconds: 604800,
    };

    switch (spec.status) {
      case "open":
        return {
          ...base,
          status: "open",
          createdAt,
          deadlineAt,
          events,
        };

      case "reserved": {
        const reservedAt = createdAt + 3600;
        return {
          ...base,
          status: "reserved",
          createdAt,
          deadlineAt,
          contributor: spec.contributor,
          reservedAt,
          version: 2,
          events: [
            ...events,
            { type: "reserved", timestamp: reservedAt, actor: spec.contributor },
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
          contributor: spec.contributor,
          reservedAt,
          submittedAt,
          version: 3,
          submissionUrl: spec.submissionUrl,
          notes: spec.notes,
          events: [
            ...events,
            { type: "reserved", timestamp: reservedAt, actor: spec.contributor },
            { type: "submitted", timestamp: submittedAt, actor: spec.contributor },
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
          contributor: spec.contributor,
          reservedAt,
          submittedAt,
          releasedAt,
          version: 4,
          releasedTxHash: spec.releasedTxHash,
          submissionUrl: spec.submissionUrl,
          events: [
            ...events,
            { type: "reserved", timestamp: reservedAt, actor: spec.contributor },
            { type: "submitted", timestamp: submittedAt, actor: spec.contributor },
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
          contributor: spec.contributor,
          reservedAt,
          refundedAt,
          version: 3,
          refundedTxHash: spec.refundedTxHash,
          events: [
            ...events,
            { type: "reserved", timestamp: reservedAt, actor: spec.contributor },
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
  });
}

function runDemoSeed() {
  const dataDir = path.dirname(STORE_PATH);
  fs.mkdirSync(dataDir, { recursive: true });

  const storeExists = fs.existsSync(STORE_PATH);
  const hasData =
    storeExists && fs.readFileSync(STORE_PATH, "utf8").trim().length > 2;

  if (hasData && !RESET) {
    console.warn("Notice: Store already has data. Overwriting with demo dataset (--reset can also be used).");
  }

  const bounties = buildDemoBounties();
  fs.writeFileSync(STORE_PATH, JSON.stringify(bounties, null, 2));

  // Also initialize audit trail cleanly
  const auditEntries = bounties.flatMap((b) =>
    (b.events || []).map((e) => ({
      bountyId: b.id,
      type: e.type,
      timestamp: e.timestamp,
      actor: e.actor || b.maintainer,
    })),
  );
  fs.writeFileSync(AUDIT_PATH, JSON.stringify(auditEntries, null, 2));

  const statusCounts = {};
  for (const b of bounties) {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  }

  console.log(`\n🎉 Seeded ${bounties.length} demo bounties across all lifecycle states:`);
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  • ${status.padEnd(10)}: ${count}`);
  }
  console.log(`\nDataset written to:\n  ${STORE_PATH}\n`);
}

runDemoSeed();
