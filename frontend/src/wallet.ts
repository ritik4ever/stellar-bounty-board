export type StellarActionSignature = {
  publicKey: string;
  signature: string;
};

type FreighterAccessResult =
  | string
  | {
      address?: string;
      publicKey?: string;
      error?: string;
    };

type FreighterSignResult =
  | string
  | {
      signature?: string;
      signedMessage?: string;
      signedPayload?: string;
      error?: string;
    };

type FreighterApi = {
  isConnected?: () => Promise<boolean | { isConnected?: boolean; error?: string }>;
  requestAccess?: () => Promise<FreighterAccessResult>;
  getPublicKey?: () => Promise<FreighterAccessResult>;
  signMessage?: (message: string, options?: Record<string, unknown>) => Promise<FreighterSignResult>;
};

declare global {
  interface Window {
    freighterApi?: FreighterApi;
    freighter?: FreighterApi;
  }
}

function getFreighter(): FreighterApi {
  const api = window.freighterApi ?? window.freighter;
  if (!api) {
    throw new Error("Freighter wallet extension was not found.");
  }
  return api;
}

function readPublicKey(result: FreighterAccessResult): string {
  if (typeof result === "string") return result;
  if (result.error) throw new Error(result.error);
  const publicKey = result.address ?? result.publicKey;
  if (!publicKey) throw new Error("Freighter did not return a public key.");
  return publicKey;
}

function readSignature(result: FreighterSignResult): string {
  if (typeof result === "string") return result;
  if (result.error) throw new Error(result.error);
  const signature = result.signature ?? result.signedMessage ?? result.signedPayload;
  if (!signature) throw new Error("Freighter did not return a signature.");
  return signature;
}

async function ensureConnected(api: FreighterApi): Promise<void> {
  if (!api.isConnected) return;
  const result = await api.isConnected();
  if (typeof result === "boolean") {
    if (!result) throw new Error("Freighter is not connected.");
    return;
  }
  if (result.error) throw new Error(result.error);
  if (result.isConnected === false) throw new Error("Freighter is not connected.");
}

export async function connectFreighterPublicKey(): Promise<string> {
  const api = getFreighter();
  if (api.requestAccess) {
    return readPublicKey(await api.requestAccess());
  }
  await ensureConnected(api);
  if (!api.getPublicKey) {
    throw new Error("Freighter public key API is not available.");
  }
  return readPublicKey(await api.getPublicKey());
}

export async function signMaintainerPayload(payload: unknown): Promise<StellarActionSignature> {
  const api = getFreighter();
  const publicKey = await connectFreighterPublicKey();
  if (!api.signMessage) {
    throw new Error("Freighter message signing API is not available.");
  }
  const message = JSON.stringify(payload);
  const signature = readSignature(await api.signMessage(message));
  return { publicKey, signature };
}
