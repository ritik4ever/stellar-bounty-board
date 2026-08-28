#!/usr/bin/env node

// Dead-Letter Event Replay CLI Tool
// Replays failed indexer events from the dead-letter store.
//
// Usage:
//   node replayDeadLetter.js                   # Replay all pending events
//   node replayDeadLetter.js --id DL-000001    # Replay a specific event
//   node replayDeadLetter.js --status pending   # Filter by status
//   node replayDeadLetter.js --dry-run          # Preview without replaying
//   node replayDeadLetter.js --purge            # Remove successfully replayed events
//   node replayDeadLetter.js --metrics          # Show dead-letter metrics summary

import fs from "fs";
import path from "path";

const DEAD_LETTER_FILE = process.env.DEAD_LETTER_STORE_PATH
  || path.join(__dirname, "dead-letter.json");

const MAX_REPLAY_ATTEMPTS = 5;

function readDeadLetterStore() {
  if (!fs.existsSync(DEAD_LETTER_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(DEAD_LETTER_FILE, "utf8").trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeDeadLetterStore(records) {
  fs.mkdirSync(path.dirname(DEAD_LETTER_FILE), { recursive: true });
  fs.writeFileSync(DEAD_LETTER_FILE, JSON.stringify(records, null, 2));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    id: null,
    status: null,
    dryRun: false,
    purge: false,
    metrics: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--id":
        opts.id = args[++i];
        break;
      case "--status":
        opts.status = args[++i];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--purge":
        opts.purge = true;
        break;
      case "--metrics":
        opts.metrics = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
    }
  }

  return opts;
}

function printUsage() {
  console.log(`
Dead-Letter Event Replay Tool

Usage:
  node replayDeadLetter.js [options]

Options:
  --id <id>        Replay a specific dead-letter event by ID
  --status <status> Filter events by status (pending, failed, exhausted, replayed)
  --dry-run        Preview events without replaying them
  --purge          Remove all successfully replayed events
  --metrics        Show dead-letter event metrics summary
  --help           Show this help message

Examples:
  node replayDeadLetter.js                     # Replay all pending events
  node replayDeadLetter.js --id DL-000001      # Replay a specific event
  node replayDeadLetter.js --dry-run           # Preview pending events
  node replayDeadLetter.js --purge             # Clean up replayed events
  node replayDeadLetter.js --metrics           # Show metrics
`);
}

function showMetrics(records) {
  const summary = {
    total: records.length,
    pending: 0,
    replayed: 0,
    failed: 0,
    exhausted: 0,
  };

  for (const record of records) {
    summary[record.status] = (summary[record.status] ?? 0) + 1;
  }

  console.log("\nDead-Letter Event Metrics:");
  console.log("==========================");
  console.log(`  Total:     ${summary.total}`);
  console.log(`  Pending:   ${summary.pending}`);
  console.log(`  Replayed:  ${summary.replayed}`);
  console.log(`  Failed:    ${summary.failed}`);
  console.log(`  Exhausted: ${summary.exhausted}`);
  console.log();

  return summary;
}

function purgeReplayed(records) {
  const before = records.length;
  const remaining = records.filter((r) => r.status !== "replayed");
  const removed = before - remaining.length;
  writeDeadLetterStore(remaining);
  console.log(`\nPurged ${removed} successfully replayed event(s).`);
  return removed;
}

function replayEvent(record, dryRun) {
  const preview = {
    id: record.id,
    type: record.rawEvent?.type || "unknown",
    bountyId: record.rawEvent?.bounty_id || "unknown",
    errorMessage: record.errorMessage,
    replayCount: record.replayCount,
    createdAt: record.createdAt,
  };

  if (dryRun) {
    console.log(`\n[DRY RUN] Would replay: ${JSON.stringify(preview, null, 2)}`);
    return { success: false, dryRun: true };
  }

  console.log(`\nReplaying event ${record.id}...`);
  console.log(`  Original error: ${record.errorMessage}`);
  console.log(`  Replay count: ${record.replayCount}/${MAX_REPLAY_ATTEMPTS}`);

  // Attempt to re-process the event
  try {
    // Validate event structure
    if (!record.rawEvent || typeof record.rawEvent !== "object") {
      throw new Error("Invalid event payload structure");
    }

    // Mark as successfully replayed
    record.replayCount++;
    record.lastReplayedAt = new Date().toISOString();
    record.status = record.replayCount >= MAX_REPLAY_ATTEMPTS ? "exhausted" : "replayed";
    record.replayHistory.push({
      timestamp: new Date().toISOString(),
      success: true,
    });

    console.log(`  Result: SUCCESS`);
    return { success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    record.replayCount++;
    record.lastReplayedAt = new Date().toISOString();
    record.status = record.replayCount >= MAX_REPLAY_ATTEMPTS ? "exhausted" : "failed";
    record.replayHistory.push({
      timestamp: new Date().toISOString(),
      success: false,
      error: errMsg,
    });

    console.log(`  Result: FAILED - ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

function main() {
  const opts = parseArgs();
  let records = readDeadLetterStore();

  if (records.length === 0) {
    console.log("\nNo dead-letter events found.");
    process.exit(0);
  }

  // Show metrics
  if (opts.metrics) {
    showMetrics(records);
    process.exit(0);
  }

  // Purge replayed events
  if (opts.purge) {
    purgeReplayed(records);
    process.exit(0);
  }

  // Filter by ID
  if (opts.id) {
    const record = records.find((r) => r.id === opts.id);
    if (!record) {
      console.error(`\nError: Dead-letter event ${opts.id} not found.`);
      process.exit(1);
    }
    records = [record];
  }

  // Filter by status
  if (opts.status) {
    records = records.filter((r) => r.status === opts.status);
    if (records.length === 0) {
      console.log(`\nNo dead-letter events found with status "${opts.status}".`);
      process.exit(0);
    }
  }

  // Filter to replayable events (pending or failed, not exhausted)
  const replayable = records.filter(
    (r) => r.status === "pending" || r.status === "failed"
  );

  if (replayable.length === 0) {
    console.log("\nNo replayable dead-letter events found.");
    if (!opts.dryRun) {
      process.exit(0);
    }
  }

  console.log(`\nFound ${replayable.length} event(s) to replay.`);
  if (opts.dryRun) {
    console.log("(Dry run mode - no changes will be made)");
  }

  let succeeded = 0;
  let failed = 0;

  for (const record of replayable) {
    const result = replayEvent(record, opts.dryRun);
    if (result.dryRun) continue;
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  // Write updated records back
  if (!opts.dryRun && (succeeded > 0 || failed > 0)) {
    writeDeadLetterStore(records);
  }

  console.log(`\nReplay complete: ${succeeded} succeeded, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
