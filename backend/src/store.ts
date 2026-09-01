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

const JSON_SECRET_SUFFIXES = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "privatekey",
  "secretkey",
  "seed",
  "jwt",
  "webhooksecret",
] as const;

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

function isSensitiveJsonKey(key: string): boolean {
  const normalized = key.toLowerCase();
  const exactMatches = new Set([
    "apikey",
    "api_key",
    "token",
    "secret",
    "password",
    "authorization",
    "cookie",
    "privatekey",
    "secretkey",
    "seed",
    "jwt",
    "sessiontoken",
    "accesstoken",
    "refreshtoken",
    "webhooksecret",
  ]);

  if (exactMatches.has(normalized)) {
    return true;
  }

  return JSON_SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function sanitizeJsonSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSecrets(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !isSensitiveJsonKey(key)
    );

    const sanitized = Object.fromEntries(
      entries.map(([key, nestedValue]) => [key, sanitizeJsonSecrets(nestedValue)])
    ) as T;

    return sanitized;
  }

  return value;
}

function ensureJsonStoreDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort: we only need to ensure the running user can read/write it.
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureJsonStoreDirectory(filePath);
  const sanitized = sanitizeJsonSecrets(value);
  fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2), "utf8");

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort: some filesystems may not support chmod semantics
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Copy `src` to `dest` only when `src` exists and is non-empty.
 * Silently swallows errors so a missing / unreadable main file never
 * prevents the backup step from completing.
 */
function backupIfExists(src: string, dest: string, initialValue?: unknown): void {
  try {
    if (!fs.existsSync(src)) {
      if (initialValue !== undefined) {
        writeJsonFile(dest, initialValue);
      }
      return;
    }

    if (fs.statSync(src).size > 0) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o600);
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
      writeJsonFile(store, bak);
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
  backupIfExists(store, backup, bounties);

  // 2. Write the new state.
  writeJsonFile(store, bounties);
}