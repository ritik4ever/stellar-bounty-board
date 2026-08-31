/**
 * Display-currency support.
 *
 * Amounts are held in USD everywhere in the app (see `xlmToUsd` in `utils.ts`),
 * so this module only deals with the last step: turning a USD value into the
 * currency the reader picked. Rates are fetched once and cached, both in memory
 * and in localStorage, so a reload does not re-fetch and an offline reload
 * still renders converted amounts.
 *
 * Every lookup here is allowed to fail. When it does, callers fall back to
 * plain USD rather than showing an error, so a currency the reader chose can
 * never take the page down with it.
 */

/** Currencies offered in the selector, besides the reader's local one. */
export const BASE_CURRENCIES = ['USD', 'EUR'] as const;

export const USD = 'USD';

export type CurrencyCode = string;

export interface CurrencyRates {
  /** Rate per 1 USD, keyed by ISO 4217 code. Always contains USD: 1. */
  rates: Record<string, number>;
  fetchedAt: number;
}

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const RATES_CACHE_MS = 12 * 60 * 60 * 1000;
const RATES_STORAGE_KEY = 'stellar-bounty-board-currency-rates';
const FETCH_TIMEOUT_MS = 5000;

export const CURRENCY_STORAGE_KEY = 'stellar-bounty-board-currency';

let cachedRates: CurrencyRates | null = null;
let inFlight: Promise<CurrencyRates> | null = null;

function isFresh(entry: CurrencyRates | null): entry is CurrencyRates {
  return entry !== null && Date.now() - entry.fetchedAt < RATES_CACHE_MS;
}

function readStoredRates(): CurrencyRates | null {
  try {
    const raw = window.localStorage.getItem(RATES_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CurrencyRates>;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || typeof parsed.rates !== 'object' || !parsed.rates) {
      return null;
    }

    return { rates: parsed.rates as Record<string, number>, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeStoredRates(entry: CurrencyRates): void {
  try {
    window.localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // A full or unavailable localStorage is not a reason to fail the render.
  }
}

/**
 * Fetch USD-based rates, preferring a cache that is still fresh.
 *
 * Concurrent callers share one request, so a page rendering twenty amounts at
 * once still makes a single network call.
 */
export async function fetchUsdRates(): Promise<CurrencyRates> {
  if (isFresh(cachedRates)) return cachedRates;

  const stored = readStoredRates();
  if (isFresh(stored)) {
    cachedRates = stored;
    return stored;
  }

  if (inFlight) return inFlight;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  inFlight = (async () => {
    try {
      const response = await fetch(RATES_URL, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch USD rates: ${response.status}`);
      }

      const data = (await response.json()) as { result?: string; rates?: Record<string, number> };
      if (data.result === 'error' || !data.rates || typeof data.rates !== 'object') {
        throw new Error('Rate response did not include a rates object');
      }

      const entry: CurrencyRates = {
        rates: { ...data.rates, [USD]: 1 },
        fetchedAt: Date.now(),
      };

      cachedRates = entry;
      writeStoredRates(entry);
      return entry;
    } finally {
      window.clearTimeout(timeoutId);
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Drop both cache layers. Exposed for tests, mirroring `resetXlmToUsdCache`. */
export function resetCurrencyRatesCache(): void {
  cachedRates = null;
  inFlight = null;
  try {
    window.localStorage.removeItem(RATES_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * The reader's own currency, derived from their browser locale.
 *
 * Returns null when the locale does not imply one, or when the runtime lacks
 * the Intl region data to work it out, in which case the selector simply does
 * not offer a local option.
 */
export function detectLocalCurrency(): string | null {
  try {
    const locale = typeof navigator === 'undefined' ? undefined : navigator.language;
    if (!locale) return null;

    // `currency` is only populated for locales that carry a region subtag.
    const resolved = new Intl.Locale(locale).maximize() as Intl.Locale & { currency?: string };
    if (typeof resolved.currency === 'string' && /^[A-Z]{3}$/.test(resolved.currency)) {
      return resolved.currency;
    }

    const region = resolved.region;
    if (!region) return null;

    return REGION_CURRENCY[region] ?? null;
  } catch {
    return null;
  }
}

/**
 * Region-to-currency fallback.
 *
 * `Intl.Locale.prototype.currency` is still missing in some engines, so this
 * covers the regions most likely to appear here rather than shipping a full
 * ISO table nothing else would use.
 */
const REGION_CURRENCY: Record<string, string> = {
  AR: 'ARS', AT: 'EUR', AU: 'AUD', BE: 'EUR', BR: 'BRL', CA: 'CAD', CH: 'CHF',
  CN: 'CNY', CZ: 'CZK', DE: 'EUR', DK: 'DKK', EG: 'EGP', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GB: 'GBP', GH: 'GHS', GR: 'EUR', HK: 'HKD', ID: 'IDR', IE: 'EUR',
  IL: 'ILS', IN: 'INR', IT: 'EUR', JP: 'JPY', KE: 'KES', KR: 'KRW', MX: 'MXN',
  MY: 'MYR', NG: 'NGN', NL: 'EUR', NO: 'NOK', NZ: 'NZD', PH: 'PHP', PK: 'PKR',
  PL: 'PLN', PT: 'EUR', RO: 'RON', RU: 'RUB', SA: 'SAR', SE: 'SEK', SG: 'SGD',
  TH: 'THB', TR: 'TRY', TW: 'TWD', UA: 'UAH', US: 'USD', VN: 'VND', ZA: 'ZAR',
};

/** Convert a USD value using a rate table. Returns null when unconvertible. */
export function convertFromUsd(
  usdValue: number,
  currency: CurrencyCode,
  rates: Record<string, number> | null,
): number | null {
  if (currency === USD) return usdValue;
  if (!rates) return null;

  const rate = rates[currency];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;

  return usdValue * rate;
}

/**
 * Format a value in a currency.
 *
 * Falls back to the plain code plus the number when the runtime does not know
 * the currency, which beats throwing inside a render.
 */
export function formatCurrency(value: number, currency: CurrencyCode, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale ?? 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Selector options: USD, EUR, and the reader's local currency when distinct. */
export function currencyOptions(local: string | null = detectLocalCurrency()): string[] {
  const options: string[] = [...BASE_CURRENCIES];
  if (local && !options.includes(local)) options.push(local);
  return options;
}
