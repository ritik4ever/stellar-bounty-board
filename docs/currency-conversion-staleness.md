# Currency Conversion Staleness Policy

## Problem

The XLM → USD conversion utility (wave-4 #9) uses CoinGecko exchange rates
but has no documented staleness or fallback policy.

## Policy

1. **Staleness**: Exchange rates are fetched at most once per 5 minutes.
   Cached rates older than 5 minutes are considered stale.
2. **Fallback**: If CoinGecko is unreachable, the last cached rate is used.
   If no cached rate exists, the conversion returns `null` (UI shows "—").
3. **Error handling**: Fetch failures are logged but do not crash the app.

## Implementation

```typescript
const RATE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedRate: number | null = null;
let cachedAt: number = 0;

export async function getXlmToUsdRate(): Promise<number | null> {
  if (Date.now() - cachedAt < RATE_CACHE_TTL_MS && cachedRate !== null) {
    return cachedRate;
  }
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd'
    );
    const data = await res.json();
    cachedRate = data.stellar.usd;
    cachedAt = Date.now();
    return cachedRate;
  } catch {
    return cachedRate; // Return stale cache or null
  }
}
```

<!-- Created: 2026-10-01 — per issue #1174 -->
