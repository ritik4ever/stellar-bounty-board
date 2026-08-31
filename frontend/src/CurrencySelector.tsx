import { useCurrency } from './CurrencyContext';

/**
 * Picks the currency every amount on the page is shown in.
 *
 * Hidden when the rate lookup failed, because USD is then the only currency
 * that can be rendered and offering the others would produce a control that
 * silently does nothing.
 */
export default function CurrencySelector() {
  const { currency, setCurrency, options, rates, ratesResolved } = useCurrency();

  if (ratesResolved && !rates) return null;
  if (options.length < 2) return null;

  return (
    <select
      className="currency-selector"
      aria-label="Display currency"
      value={currency}
      onChange={(event) => setCurrency(event.target.value)}
    >
      {options.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
