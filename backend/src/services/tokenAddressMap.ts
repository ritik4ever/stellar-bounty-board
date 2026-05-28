const TOKEN_SYMBOL_REGEX = /^[A-Za-z0-9]{1,12}$/;
const SOROBAN_ADDRESS_REGEX = /^C[A-Z2-7]{55}$/;

const DEFAULT_TOKEN_ADDRESS_MAP: Record<string, string> = {
  XLM: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  USDC: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
};

function normalizeTokenMap(map: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [rawSymbol, rawAddress] of Object.entries(map)) {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!TOKEN_SYMBOL_REGEX.test(symbol)) {
      throw new Error(`Invalid token symbol in BOUNTY_TOKEN_ADDRESS_MAP: ${rawSymbol}`);
    }
    if (typeof rawAddress !== "string" || !SOROBAN_ADDRESS_REGEX.test(rawAddress.trim())) {
      throw new Error(`Invalid Soroban token address configured for ${symbol}.`);
    }
    normalized[symbol] = rawAddress.trim();
  }

  return normalized;
}

export function getTokenAddressMap(): Record<string, string> {
  const raw = process.env.BOUNTY_TOKEN_ADDRESS_MAP?.trim();
  if (!raw) {
    return DEFAULT_TOKEN_ADDRESS_MAP;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BOUNTY_TOKEN_ADDRESS_MAP must be a JSON object mapping token symbols to Soroban addresses.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BOUNTY_TOKEN_ADDRESS_MAP must be a JSON object mapping token symbols to Soroban addresses.");
  }

  return {
    ...DEFAULT_TOKEN_ADDRESS_MAP,
    ...normalizeTokenMap(parsed as Record<string, unknown>),
  };
}

export function normalizeTokenSymbol(tokenSymbol: string): string {
  const symbol = tokenSymbol.trim().toUpperCase();
  if (!TOKEN_SYMBOL_REGEX.test(symbol)) {
    throw new Error("Token symbol must be 1-12 letters or numbers.");
  }
  return symbol;
}

export function resolveTokenAddress(tokenSymbol: string): string {
  const symbol = normalizeTokenSymbol(tokenSymbol);
  const tokenAddress = getTokenAddressMap()[symbol];

  if (!tokenAddress) {
    throw new Error(`Unsupported token symbol ${symbol}. Configure BOUNTY_TOKEN_ADDRESS_MAP to enable it.`);
  }

  return tokenAddress;
}
