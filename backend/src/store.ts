/**
 * store.ts – JSON-backed persistence for bounties with automatic backup.
 *
 * Behaviour:
 *  - Before every write, the current file is copied to <storePath>.bak
 *  - On startup (loadBounties), if the main file contains invalid JSON the
 *    module automatically falls back to the .bak file and logs a warning.
 *  - All I/O is synchronous so callers don't need to await anything.
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveStorePath(): string {
  return (
    process.env.BOUNTY_STORE_PATH ??
    path.join(__dirname, "../data/bounties.json")
  );
}

export function resolveBackupPath(storePath: string): string {
  return `${storePath}.bak`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Copy `src` to `dest` only when `src` exists and is non-empty.
 * Silently swallows errors so a missing / unreadable main file never
 * prevents the backup step from completing.
 */
function backupIfExists(src: string, dest: string): void {
  try {
    if (fs.existsSync(src) && fs.statSync(src).size > 0) {
      fs.copyFileSync(src, dest);
    }
  } catch {
    // Non-fatal – we proceed with the write regardless.
  }
}

/**
 * Parse JSON from `filePath`. Returns the parsed value or `null` when the
 * file is missing or contains invalid JSON.
 */
function tryParse<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load bounties from disk.
 *
 * 1. Try the main store file.
 * 2. If it is absent or corrupt, attempt recovery from the .bak file and log
 *    a warning.
 * 3. If neither file is readable, return an empty array.
 */
export function loadBounties<T = unknown>(storePath?: string): T[] {
  const store = storePath ?? resolveStorePath();
  const backup = resolveBackupPath(store);

  // Happy path – main file is valid.
  const primary = tryParse<T[]>(store);
  if (primary !== null) {
    return primary;
  }

  // Main file is missing or corrupt – try the backup.
  const bak = tryParse<T[]>(backup);
  if (bak !== null) {
    console.warn(
      `[store] WARNING: "${store}" is missing or contains invalid JSON. ` +
        `Restored ${bak.length} bounties from backup "${backup}".`
    );
    // Restore the main file from the backup so future reads succeed.
    try {
      fs.writeFileSync(store, JSON.stringify(bak, null, 2), "utf8");
    } catch (writeErr) {
      console.warn(
        `[store] WARNING: Could not restore main store from backup: ${writeErr}`
      );
    }
    return bak;
  }

  // Nothing usable – start fresh.
  return [];
}

/**
 * Persist `bounties` to disk.
 *
 * The current file is backed up to `<storePath>.bak` before the new content
 * is written, so a crash during the write leaves the previous state intact.
 */
export function saveBounties<T = unknown>(
  bounties: T[],
  storePath?: string
): void {
  const store = storePath ?? resolveStorePath();
  const backup = resolveBackupPath(store);

  // Ensure the directory exists.
  fs.mkdirSync(path.dirname(store), { recursive: true });

  // 1. Back up the current state before touching the main file.
  backupIfExists(store, backup);

  // 2. Write the new state.
  fs.writeFileSync(store, JSON.stringify(bounties, null, 2), "utf8");
}