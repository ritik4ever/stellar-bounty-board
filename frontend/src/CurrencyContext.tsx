import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import {
  CURRENCY_STORAGE_KEY,
  USD,
  currencyOptions,
  detectLocalCurrency,
  fetchUsdRates,
  type CurrencyCode,
} from './currency';

interface CurrencyContextValue {
  /** The currency the reader picked. Always a valid option. */
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  /** Currencies to offer: USD, EUR, and the reader's local one when distinct. */
  options: string[];
  /** USD-based rates, or null while loading or after a failed lookup. */
  rates: Record<string, number> | null;
  /** True once a lookup has settled, either way. */
  ratesResolved: boolean;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

/**
 * Holds the display currency for the whole app.
 *
 * The choice lives in one place rather than per component so that changing it
 * once updates every amount on the page, and it is persisted through
 * `useLocalStorage`, which also keeps other open tabs in step.
 *
 * Rates are fetched once here rather than per amount. A failed fetch leaves
 * `rates` null forever, which is what makes every consumer fall back to USD.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useLocalStorage<string>(CURRENCY_STORAGE_KEY, USD);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [ratesResolved, setRatesResolved] = useState(false);

  const options = useMemo(() => currencyOptions(detectLocalCurrency()), []);

  // A stored currency that is no longer offered (a different device, or a
  // locale change) would otherwise leave the selector showing nothing.
  const currency = options.includes(stored) ? stored : USD;

  useEffect(() => {
    let active = true;

    fetchUsdRates()
      .then((entry) => {
        if (active) {
          setRates(entry.rates);
          setRatesResolved(true);
        }
      })
      .catch(() => {
        if (active) {
          setRates(null);
          setRatesResolved(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency, setCurrency: setStored, options, rates, ratesResolved }),
    [currency, setStored, options, rates, ratesResolved],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * Read the display currency.
 *
 * Usable outside a provider, where it reports USD with no alternatives. That
 * keeps a component rendered on its own, in a test or a story, from throwing.
 */
export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);

  if (context) return context;

  return { currency: USD, setCurrency: () => {}, options: [USD], rates: null, ratesResolved: true };
}
