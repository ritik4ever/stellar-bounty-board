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
const RPC_TIMEOUT_MS = 5_000;

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

export async function runDeepHealthCheck(): Promise<DeepHealthResult> {
  const [store, soroban, contract, auth] = await Promise.all([
    Promise.resolve(checkStore()),
    checkSorobanRpc(),
    Promise.resolve(checkContract()),
    Promise.resolve(checkAuth()),
  ]);

  const components = { store, soroban, contract, auth };
  const overall = Object.values(components).every((status) => status === "up") ? "up" : "down";

  return {
    overall,
    components,
    timestamp: new Date().toISOString(),
  };
}
