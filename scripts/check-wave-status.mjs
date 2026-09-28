#!/usr/bin/env node
/**
 * Keeps `docs/wave-status.md` honest (#1467).
 *
 * `docs/wave-*.md` are the contribution backlogs. `docs/wave-status.md` is the
 * single reconciliation of every backlog line item against the live issue
 * tracker. This script is what stops the reconciliation from rotting: it runs on
 * every PR (see `.github/workflows/pr-check.yml`), so a PR that adds, removes or
 * renumbers a backlog item fails until the status document is updated in the
 * same PR.
 *
 * Two modes:
 *
 *   1. Structural (default, no network) — every wave item has exactly one row
 *      in `docs/wave-status.md`; every row belongs to a real wave item; the
 *      issue cell is `#<number>` or `not-opened` with a matching status; the
 *      status is one of the documented values.
 *
 *   2. `--live` (needs `gh` authenticated against the repo) — additionally
 *      compares each mapped issue's state with what the status document claims,
 *      and fails when the snapshot has drifted. Run this from the scheduled
 *      workflow (`.github/workflows/wave-status-drift.yml`) rather than on every
 *      PR, so a status change on GitHub does not block unrelated PRs.
 *
 * Usage:
 *
 *   node scripts/check-wave-status.mjs
 *   node scripts/check-wave-status.mjs --live
 *   node scripts/check-wave-status.mjs --help
 *
 * Environment:
 *
 *   WAVE_STATUS_REPO   optional - owner/repo used by `--live`
 *                      (default: ritik4ever/stellar-bounty-board)
 *
 * Exit codes:
 *   0 - the status document is consistent
 *   1 - it is not (details are printed)
 *   2 - the script could not run (missing files, missing `gh`, …)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const STATUS_DOC = path.join(DOCS_DIR, 'wave-status.md');
const REPO = process.env.WAVE_STATUS_REPO || 'ritik4ever/stellar-bounty-board';

/** Statuses allowed in the status column of `docs/wave-status.md`. */
const ALLOWED_STATUSES = new Set(['open', 'closed', 'superseded', 'not-opened']);

/** Issue cell used for items that have no GitHub issue yet. */
const NOT_OPENED = 'not-opened';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/check-wave-status.mjs [--live]',
      '',
      '  (default)  structural checks only; safe to run offline and in CI on every PR',
      '  --live     also compare docs/wave-status.md against live issue states via `gh`',
    ].join('\n')
  );
  process.exit(0);
}
const live = args.includes('--live');

const problems = [];

/**
 * Extract every backlog item from a wave document.
 *
 * Rows look like `| 16 | Add rate limiting per IP ... | `backend/src/app.ts` |`;
 * the summary tables at the top of each doc have a labelled (non-numeric) first
 * cell, so they are skipped.
 */
function parseWaveDoc(filePath, wave) {
  const text = readFileSync(filePath, 'utf8');
  const items = [];

  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!match) continue;
    items.push({
      key: `W${wave}.${match[1]}`,
      wave,
      title: match[2].replace(/\s+/g, ' ').trim(),
    });
  }

  return items;
}

function readWaveItems() {
  const waveFiles = readdirSync(DOCS_DIR)
    .filter((name) => /^wave-\d+\.md$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  if (waveFiles.length === 0) {
    problems.push('No docs/wave-N.md backlog document was found; nothing to reconcile.');
    return [];
  }

  const items = [];
  for (const name of waveFiles) {
    const wave = Number(name.match(/\d+/)[0]);
    items.push(...parseWaveDoc(path.join(DOCS_DIR, name), wave));
  }
  return items;
}

/**
 * Extract the rows of `docs/wave-status.md`.
 *
 * Expected row shape:
 * `| W4.1 | Extract ... | [#66](...) | closed | Later duplicate: #821 |`
 */
function readStatusRows() {
  const text = readFileSync(STATUS_DOC, 'utf8');
  const rows = [];

  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*(W\d+\.\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/);
    if (!match) continue;

    const issueCell = match[3].trim();
    const issueMatch = issueCell.match(/#(\d+)/);

    rows.push({
      key: match[1],
      title: match[2].trim(),
      issueCell,
      issue: issueMatch ? Number(issueMatch[1]) : null,
      status: match[4].trim().toLowerCase(),
      notes: match[5].trim(),
    });
  }

  return rows;
}

function structuralChecks(waveItems, statusRows) {
  const byKey = new Map();
  for (const item of waveItems) {
    byKey.set(item.key, item);
  }

  const seen = new Map();
  for (const row of statusRows) {
    if (!byKey.has(row.key)) {
      problems.push(
        `${row.key}: not a backlog item in any docs/wave-*.md document (stale row, or the item was renumbered/removed).`
      );
    }
    if (seen.has(row.key)) {
      problems.push(`${row.key}: duplicated in docs/wave-status.md (${seen.get(row.key)} and ${row.title}).`);
    }
    seen.set(row.key, row.title);

    if (!ALLOWED_STATUSES.has(row.status)) {
      problems.push(
        `${row.key}: status "${row.status}" is not one of ${[...ALLOWED_STATUSES].join(', ')}.`
      );
    }

    const hasIssue = row.issue !== null;
    if (!hasIssue && row.issueCell !== NOT_OPENED) {
      problems.push(
        `${row.key}: issue cell "${row.issueCell}" is neither a "#<number>" reference nor "${NOT_OPENED}".`
      );
    }
    if (!hasIssue && row.status !== NOT_OPENED) {
      problems.push(`${row.key}: has no issue number but the status is "${row.status}" (expected "${NOT_OPENED}").`);
    }
    if (hasIssue && row.status === NOT_OPENED) {
      problems.push(`${row.key}: points at #${row.issue} but is marked "${NOT_OPENED}".`);
    }
    if (row.status === 'open' && !row.notes) {
      problems.push(`${row.key}: status "open" should carry a note explaining what is still outstanding.`);
    }
  }

  for (const item of waveItems) {
    if (!seen.has(item.key)) {
      problems.push(`${item.key}: "${item.title}" is missing from docs/wave-status.md.`);
    }
  }
}

/** Ask `gh` for the current state of every mapped issue. */
function fetchLiveStates(issueNumbers) {
  if (issueNumbers.length === 0) return new Map();

  let raw;
  try {
    raw = execFileSync(
      'gh',
      [
        'issue',
        'list',
        '--repo',
        REPO,
        '--state',
        'all',
        '--limit',
        '5000',
        '--json',
        'number,state,title',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (error) {
    console.error(
      `[fail] Could not read issues from ${REPO} via \`gh\`.\n` +
        `       ${error instanceof Error ? error.message : String(error)}\n` +
        '       Run `gh auth status` and retry, or omit --live for the offline check.'
    );
    process.exit(2);
  }

  const wanted = new Set(issueNumbers);
  const states = new Map();
  for (const issue of JSON.parse(raw)) {
    if (wanted.has(issue.number)) {
      states.set(issue.number, { state: issue.state.toLowerCase(), title: issue.title });
    }
  }
  return states;
}

function liveChecks(statusRows, waveItems) {
  const mapped = statusRows.filter((row) => row.issue !== null);
  const states = fetchLiveStates(mapped.map((row) => row.issue));
  const titleByKey = new Map(waveItems.map((item) => [item.key, item.title]));

  const drifted = [];

  for (const row of mapped) {
    const live = states.get(row.issue);
    if (!live) {
      drifted.push(`${row.key}: #${row.issue} no longer exists in ${REPO}.`);
      continue;
    }
    if (row.status === 'open' && live.state !== 'open') {
      drifted.push(`${row.key}: #${row.issue} is now ${live.state.toUpperCase()} but the document says "open".`);
    }
    if (row.status === 'closed' && live.state !== 'closed') {
      drifted.push(
        `${row.key}: #${row.issue} is ${live.state.toUpperCase()} but the document says "closed" ("${live.title}").`
      );
    }
    if (row.status === 'superseded' && live.state !== 'closed' && live.state !== 'open') {
      drifted.push(`${row.key}: #${row.issue} has unexpected state "${live.state}".`);
    }
  }

  if (drifted.length > 0) {
    console.log('[fail] docs/wave-status.md has drifted from the live issue tracker:\n');
    for (const line of drifted) console.log(`  - ${line}`);
    console.log(
      `\nRefresh the snapshot in docs/wave-status.md (${titleByKey.size} backlog items tracked) and re-run.`
    );
    problems.push(...drifted);
  } else {
    console.log(`[ok] docs/wave-status.md matches ${REPO} for all ${mapped.length} mapped issues.`);
  }
}

function main() {
  if (!readdirSync(DOCS_DIR).includes('wave-status.md')) {
    console.error(`[fail] ${path.relative(REPO_ROOT, STATUS_DOC)} does not exist.`);
    process.exit(2);
  }

  const waveItems = readWaveItems();
  const statusRows = readStatusRows();

  structuralChecks(waveItems, statusRows);

  if (problems.length > 0) {
    console.error('[fail] docs/wave-status.md is inconsistent with the wave backlogs:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\n${waveItems.length} backlog items across docs/wave-*.md, ${statusRows.length} rows in docs/wave-status.md.`
    );
    process.exit(1);
  }

  console.log(
    `[ok] Every one of the ${waveItems.length} items in docs/wave-*.md has exactly one row in docs/wave-status.md.`
  );

  if (live) {
    liveChecks(statusRows, waveItems);
    if (problems.length > 0) process.exit(1);
  }
}

main();
