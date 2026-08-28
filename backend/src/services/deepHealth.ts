import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

export type ComponentStatus = "up" | "down";

export interface DatabasePoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount?: number;
}

export interface DatabaseHealthDetail {
  status: ComponentStatus;
  latencyMs?: number;
  pool?: DatabasePoolStats;
  error?: string;
}

export interface DeepHealthResult {
  overall: ComponentStatus;
  components: {
    store: ComponentStatus;
    soroban: ComponentStatus;
    contract: ComponentStatus;
    auth: ComponentStatus;
    database: DatabaseHealthDetail;
  };
  timestamp: string;
}

const DEFAULT_SOROBAN_RPC_URL = "https://rpc-futurenet.stellar.org";
const RPC_TIMEOUT_MS = 5_000;
const DB_TIMEOUT_MS = 5_000;

let dbPool: Pool | null = null;
let currentDatabaseUrl: string | null = null;

export function getDbPool(): Pool | null {
  const url = process.env.DATABASE_URL?.trim() || "";
  if (!url) {
    if (dbPool) {
      void dbPool.end().catch(() => {});
      dbPool = null;
      currentDatabaseUrl = null;
    }
    return null;
  }

  if (!dbPool || currentDatabaseUrl !== url) {
    if (dbPool) {
      void dbPool.end().catch(() => {});
    }
    dbPool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: DB_TIMEOUT_MS,
    });
    currentDatabaseUrl = url;
  }

  return dbPool;
}

export function setDbPool(pool: Pool | null): void {
  dbPool = pool;
  currentDatabaseUrl = process.env.DATABASE_URL?.trim() || null;
}

export async function closeDbPool(): Promise<void> {
  if (dbPool) {
    try {
      await dbPool.end();
    } catch {
      /* best-effort */
    }
    dbPool = null;
    currentDatabaseUrl = null;
  }
}

function resolveStorePath(): string {
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim());
  }
  return path.resolve(__dirname, "../../data/bounties.json");
}

function resolveContractId(): string {
  return (
    process.env.SOROBAN_CONTRACT_ID?.trim() ||
    process.env.CONTRACT_ID?.trim() ||
    ""
  );
}

function resolveMaintainerKeys(): string[] {
  const raw = process.env.MAINTAINER_PUBLIC_KEYS ?? process.env.MAINTAINER_PUBLIC_KEY ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function checkStore(): ComponentStatus {
  try {
    const storePath = resolveStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });

    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(storePath, "[]", "utf8");
    }

    const raw = fs.readFileSync(storePath, "utf8");
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) {
      return "down";
    }

    const probePath = `${storePath}.health-probe`;
    const marker = JSON.stringify({ probe: true, ts: Date.now() });
    fs.writeFileSync(probePath, marker, "utf8");
    const readBack = fs.readFileSync(probePath, "utf8");
    if (readBack !== marker) {
      return "down";
    }
    fs.unlinkSync(probePath);

    return "up";
  } catch {
    return "down";
  }
}

async function checkSorobanRpc(): Promise<ComponentStatus> {
  const rpcUrl = (process.env.SOROBAN_RPC_URL?.trim() || DEFAULT_SOROBAN_RPC_URL).replace(/\/$/, "");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return "down";
    }

    const body = (await response.json()) as { result?: { status?: string } };
    return body.result?.status === "healthy" ? "up" : "down";
  } catch {
    return "down";
  }
}

function checkContract(): ComponentStatus {
  return resolveContractId() ? "up" : "down";
}

function checkAuth(): ComponentStatus {
  const maintainerKeys = resolveMaintainerKeys();
  const arbiter = process.env.ARBITER_ADDRESS?.trim() ?? "";

  return maintainerKeys.length > 0 && arbiter.length > 0 ? "up" : "down";
}

export async function checkDatabase(): Promise<DatabaseHealthDetail> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return {
      status: "down",
      error: "DATABASE_URL is not configured",
    };
  }

  let pool: Pool | null = null;
  try {
    pool = getDbPool();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "down",
      error: message,
    };
  }

  if (!pool) {
    return {
      status: "down",
      error: "DATABASE_URL is not configured",
    };
  }

  const startTime = Date.now();
  let timer: NodeJS.Timeout | null = null;

  try {
    const queryPromise = pool.query("SELECT 1");
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Database check timed out after ${DB_TIMEOUT_MS}ms`));
      }, DB_TIMEOUT_MS);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
    });

    await Promise.race([queryPromise, timeoutPromise]);
    if (timer) {
      clearTimeout(timer);
    }

    const latencyMs = Math.max(0, Date.now() - startTime);
    const totalCount = pool.totalCount ?? 0;
    const idleCount = pool.idleCount ?? 0;
    const waitingCount = pool.waitingCount ?? 0;
    const activeCount = Math.max(0, totalCount - idleCount);

    return {
      status: "up",
      latencyMs,
      pool: {
        totalCount,
        idleCount,
        waitingCount,
        activeCount,
      },
    };
  } catch (err) {
    if (timer) {
      clearTimeout(timer);
    }
    const latencyMs = Math.max(0, Date.now() - startTime);
    const message = err instanceof Error ? err.message : String(err);
    const totalCount = pool.totalCount ?? 0;
    const idleCount = pool.idleCount ?? 0;
    const waitingCount = pool.waitingCount ?? 0;
    const activeCount = Math.max(0, totalCount - idleCount);

    return {
      status: "down",
      latencyMs,
      pool: {
        totalCount,
        idleCount,
        waitingCount,
        activeCount,
      },
      error: message,
    };
  }
}

export async function runDeepHealthCheck(): Promise<DeepHealthResult> {
  const [store, soroban, contract, auth, database] = await Promise.all([
    Promise.resolve(checkStore()),
    checkSorobanRpc(),
    Promise.resolve(checkContract()),
    Promise.resolve(checkAuth()),
    checkDatabase(),
  ]);

  const components = { store, soroban, contract, auth, database };
  const overall: ComponentStatus =
    store === "up" &&
    soroban === "up" &&
    contract === "up" &&
    auth === "up" &&
    database.status === "up"
      ? "up"
      : "down";

  return {
    overall,
    components,
    timestamp: new Date().toISOString(),
  };
}
