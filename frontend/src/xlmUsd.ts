const XLM_USD_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";
const XLM_USD_CACHE_MS = 5 * 60 * 1000;
const XLM_USD_TIMEOUT_MS = 5000;

let cachedXlmUsdRate: { rate: number; fetchedAt: number } | null = null;
let pendingXlmUsdRate: Promise<number> | null = null;

async function fetchXlmUsdRate(): Promise<number> {
  if (cachedXlmUsdRate && Date.now() - cachedXlmUsdRate.fetchedAt < XLM_USD_CACHE_MS) {
    return cachedXlmUsdRate.rate;
  }

  if (pendingXlmUsdRate) return pendingXlmUsdRate;

  pendingXlmUsdRate = (async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), XLM_USD_TIMEOUT_MS);

    try {
      const response = await fetch(XLM_USD_PRICE_URL, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch XLM/USD rate: ${response.status}`);
      }

      const data = (await response.json()) as { stellar?: { usd?: number } };
      const rate = data.stellar?.usd;

      if (typeof rate !== "number" || !Number.isFinite(rate)) {
        throw new Error("CoinGecko response did not include a numeric XLM/USD rate");
      }

      cachedXlmUsdRate = { rate, fetchedAt: Date.now() };
      return rate;
    } finally {
      window.clearTimeout(timeoutId);
      pendingXlmUsdRate = null;
    }
  })();

  return pendingXlmUsdRate;
}

export async function xlmToUsd(amount: number): Promise<string> {
  try {
    const rate = await fetchXlmUsdRate();
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount * rate);
  } catch {
    return "USD unavailable";
  }
}

export function resetXlmToUsdCache(): void {
  cachedXlmUsdRate = null;
  pendingXlmUsdRate = null;
}
