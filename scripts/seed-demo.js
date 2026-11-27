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

const {
  SEED_BASE_EPOCH,
  DEMO_BOUNTIES_SPEC,
  buildDemoBounties,
} = require("./seed-inputs");

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
function runDemoSeed() {
  const dataDir = path.dirname(STORE_PATH);
  fs.mkdirSync(dataDir, { recursive: true });

  const storeExists = fs.existsSync(STORE_PATH);
  const hasData =
    storeExists && fs.readFileSync(STORE_PATH, "utf8").trim().length > 2;

  if (hasData && !RESET) {
    console.warn("Notice: Store already has data. Overwriting with demo dataset (--reset can also be used).");
  }

  // Deterministic dataset: fixed base epoch + fixture offsets from seed-inputs.
  const bounties = buildDemoBounties({
    baseEpoch: SEED_BASE_EPOCH,
    maintainer: MAINTAINER,
  });
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
  console.log(`\nBase epoch: ${SEED_BASE_EPOCH} (deterministic)`);
  console.log(`Fixtures:   ${DEMO_BOUNTIES_SPEC.length} specs`);
  console.log(`\nDataset written to:\n  ${STORE_PATH}\n`);
}

runDemoSeed();
