#!/usr/bin/env -S npx tsx
/**
 * force-expire.ts
 *
 * Admin CLI to force-expire a stale bounty (past its deadline) or a stale
 * reservation (past its reservation timeout) through the existing
 * bountyStore interface, replacing manual bounties.json edits.
 *
 * Authentication reuses the same ADMIN_API_KEY_HASH bcrypt hash as the
 * /api/audit-log admin endpoint (see src/middleware/adminAuth.ts and
 * scripts/hash-admin-key.js at the repo root). The --yes flag is a second,
 * explicit confirmation that a state mutation is intended.
 *
 * Usage (from backend/):
 *   ADMIN_API_KEY_HASH=<hash> npx tsx scripts/force-expire.ts <bountyId> \
 *     --key <adminKey> --actor <adminIdentity> --yes
 *
 * Example:
 *   ADMIN_API_KEY_HASH=$2b$12$... npx tsx scripts/force-expire.ts BNT-0042 \
 *     --key "s3cr3t-k3y-here" --actor "ops-jane" --yes
 */

import bcrypt from "bcryptjs";
import { adminForceExpireBounty } from "../src/services/bountyStore";

interface ParsedArgs {
  bountyId: string;
  key: string;
  actor: string;
  confirmed: boolean;
}

function printUsage(): void {
  console.error(
    "Usage: tsx scripts/force-expire.ts <bountyId> --key <adminKey> --actor <adminIdentity> --yes",
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const bountyId = argv[0];
  let key: string | undefined;
  let actor: string | undefined;
  let confirmed = false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--key") {
      key = argv[++i];
    } else if (arg === "--actor") {
      actor = argv[++i];
    } else if (arg === "--yes") {
      confirmed = true;
    }
  }

  if (!bountyId || !key || !actor) {
    printUsage();
    process.exit(1);
  }

  if (!confirmed) {
    console.error("Refusing to mutate state without --yes (explicit confirmation required).");
    printUsage();
    process.exit(1);
  }

  return { bountyId, key, actor, confirmed };
}

async function verifyAdminKey(key: string): Promise<void> {
  const storedHash = process.env.ADMIN_API_KEY_HASH;
  if (!storedHash) {
    console.error("ADMIN_API_KEY_HASH is not set. Refusing to run without admin authentication.");
    process.exit(1);
  }

  const match = await bcrypt.compare(key, storedHash);
  if (!match) {
    console.error("Invalid admin key.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { bountyId, key, actor } = parseArgs(process.argv.slice(2));

  await verifyAdminKey(key);

  const { bounty, trigger, mutated } = await adminForceExpireBounty(bountyId, actor);

  if (!mutated) {
    console.log(`Bounty ${bounty.id} is already expired — nothing to do.`);
    return;
  }

  console.log(`Force-expired bounty ${bounty.id} (trigger: ${trigger}) -> status: ${bounty.status}`);
}

main().catch((err) => {
  console.error("Force-expire failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
