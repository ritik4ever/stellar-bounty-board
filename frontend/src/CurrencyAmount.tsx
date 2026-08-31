import { useEffect, useState } from 'react';
import { xlmToUsdValue } from './utils';
import { useCurrency } from './CurrencyContext';
import { USD, convertFromUsd, formatCurrency } from './currency';

interface CurrencyAmountProps {
  amount: number;
  tokenSymbol?: string;
  /**
   * Render without the surrounding parentheses. The parenthesised form is what
   * `UsdAmount` has always shown next to a token amount.
   */
  bare?: boolean;
}

/**
 * A token amount shown in the reader's chosen display currency.
 *
 * Resolves the amount to USD once, then converts for display, so switching
 * currency never re-hits the token price feed. When the rate lookup has failed
 * the USD value is shown as-is, which keeps this component working exactly as
 * `UsdAmount` did before currencies were selectable.
 */
export default function CurrencyAmount({ amount, tokenSymbol = 'XLM', bare = false }: CurrencyAmountProps) {
  const { currency, rates, ratesResolved } = useCurrency();
  const [usdValue, setUsdValue] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const symbol = tokenSymbol.toUpperCase();

    // USDC is dollar-denominated, so it needs no price lookup.
    if (symbol === 'USDC') {
      setUsdValue(amount);
      setIsLoading(false);
      return;
    }

    // Only XLM has a price feed. Anything else would otherwise be valued at the
    // XLM rate, which would be wrong rather than merely unavailable.
    if (symbol !== 'XLM') {
      setUsdValue(null);
      setIsLoading(false);
      return;
    }

    xlmToUsdValue(amount)
      .then((value) => {
        if (active) {
          setUsdValue(value);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setUsdValue(null);
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [amount, tokenSymbol]);

  // Wait for the rates before painting a converted figure, so a non-USD reader
  // never sees the amount jump from dollars to their currency after a beat.
  if (isLoading || (currency !== USD && !ratesResolved)) {
    return <span className="usd-amount">{bare ? 'Loading...' : '(Loading...)'}</span>;
  }

  if (usdValue === null) return null;

  // A missing or unusable rate falls back to USD rather than hiding the amount.
  const converted = convertFromUsd(usdValue, currency, rates);
  const displayCurrency = converted === null ? USD : currency;
  const displayValue = converted === null ? usdValue : converted;

  const formatted = formatCurrency(displayValue, displayCurrency);

  return <span className="usd-amount">{bare ? formatted : `(${formatted})`}</span>;
}
