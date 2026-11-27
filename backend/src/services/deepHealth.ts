import fs from "node:fs";
import path from "node:path";

export type ComponentStatus = "up" | "down";

export interface DeepHealthResult {
  overall: ComponentStatus;
  components: {
    store: ComponentStatus;
    soroban: ComponentStatus;
    contract: ComponentStatus;
    auth: ComponentStatus;
  };
  timestamp: string;
}

const DEFAULT_SOROBAN_RPC_URL = "https://rpc-futurenet.stellar.org";
const DEFAULT_COMPONENT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

function resolveComponentTimeoutMs(): number {
  const configured = Number(process.env.DEEP_HEALTH_CHECK_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0 && configured <= MAX_TIMEOUT_MS
    ? configured
    : DEFAULT_COMPONENT_TIMEOUT_MS;
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

async function checkStore(): Promise<ComponentStatus> {
  try {
    const storePath = resolveStorePath();
    await fs.promises.mkdir(path.dirname(storePath), { recursive: true });

    try {
      await fs.promises.access(storePath);
    } catch {
      await fs.promises.writeFile(storePath, "[]", "utf8");
    }

    const raw = await fs.promises.readFile(storePath, "utf8");
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) {
      return "down";
    }

    const probePath = `${storePath}.health-probe`;
    const marker = JSON.stringify({ probe: true, ts: Date.now() });
    await fs.promises.writeFile(probePath, marker, "utf8");
    const readBack = await fs.promises.readFile(probePath, "utf8");
    if (readBack !== marker) {
      return "down";
    }
    await fs.promises.unlink(probePath);

    return "up";
  } catch {
    return "down";
  }
}

async function checkSorobanRpc(signal: AbortSignal): Promise<ComponentStatus> {
  const rpcUrl = (process.env.SOROBAN_RPC_URL?.trim() || DEFAULT_SOROBAN_RPC_URL).replace(/\/$/, "");

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal,
    });

    if (!response.ok) {
      return "down";
    }

    const body = (await response.json()) as { result?: { status?: string } };
    return body.result?.status === "healthy" ? "up" : "down";
  } catch {
    return "down";
  }
}

async function runWithTimeout(
  check: (signal: AbortSignal) => ComponentStatus | Promise<ComponentStatus>,
  timeoutMs: number,
): Promise<ComponentStatus> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      Promise.resolve().then(() => check(controller.signal)),
      new Promise<ComponentStatus>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve("down");
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
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

export async function runDeepHealthCheck(): Promise<DeepHealthResult> {
  const timeoutMs = resolveComponentTimeoutMs();
  const [store, soroban, contract, auth] = await Promise.all([
    runWithTimeout(checkStore, timeoutMs),
    runWithTimeout(checkSorobanRpc, timeoutMs),
    runWithTimeout(checkContract, timeoutMs),
    runWithTimeout(checkAuth, timeoutMs),
  ]);

  const components = { store, soroban, contract, auth };
  const overall = Object.values(components).every((status) => status === "up") ? "up" : "down";

  return {
    overall,
    components,
    timestamp: new Date().toISOString(),
  };
}
