import type { CreateBountyPayload } from "./types";

const DEFAULT_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const STROOPS_PER_XLM = 10_000_000;

export interface SorobanFeeEstimate {
  feeStroops: number;
  feeXlm: string;
}

interface SorobanRpcError {
  message?: string;
}

interface SorobanSimulationResult {
  minResourceFee?: string | number;
  feeCharged?: string | number;
  transactionData?: {
    minResourceFee?: string | number;
  };
}

interface SorobanRpcResponse {
  result?: SorobanSimulationResult;
  error?: SorobanRpcError;
}

export function formatStroopsAsXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7);
}

function createSimulationEnvelope(payload: CreateBountyPayload): string {
  const simulationPayload = {
    action: "create_bounty",
    maintainer: payload.maintainer,
    tokenSymbol: payload.tokenSymbol,
    amount: payload.amount,
    repo: payload.repo,
    issueNumber: payload.issueNumber,
    title: payload.title,
    deadlineDays: payload.deadlineDays,
  };
  const json = JSON.stringify(simulationPayload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function readFeeStroops(result: SorobanSimulationResult | undefined): number {
  const rawFee = result?.minResourceFee ?? result?.feeCharged ?? result?.transactionData?.minResourceFee;
  const feeStroops = Number(rawFee);

  if (!Number.isFinite(feeStroops) || feeStroops < 0) {
    throw new Error("Soroban RPC simulation did not return a valid fee estimate.");
  }

  return feeStroops;
}

export async function estimateCreateBountyFee(
  payload: CreateBountyPayload,
  rpcUrl = import.meta.env.VITE_SOROBAN_RPC_URL ?? DEFAULT_SOROBAN_RPC_URL,
): Promise<SorobanFeeEstimate> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "create-bounty-fee-preview",
      method: "simulateTransaction",
      params: {
        transaction: createSimulationEnvelope(payload),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Soroban RPC simulation failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as SorobanRpcResponse;

  if (body.error) {
    throw new Error(body.error.message ?? "Soroban RPC simulation failed.");
  }

  const feeStroops = readFeeStroops(body.result);
  return {
    feeStroops,
    feeXlm: formatStroopsAsXlm(feeStroops),
  };
}
