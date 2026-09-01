import CurrencyAmount from './CurrencyAmount';

interface UsdAmountProps {
  amount: number;
  tokenSymbol?: string;
}

/**
 * @deprecated Use `CurrencyAmount`, which renders in the reader's chosen
 * display currency. This wrapper is kept so existing imports keep working; it
 * behaves identically when the selected currency is USD, and follows the
 * selection otherwise.
 */
export default function UsdAmount({ amount, tokenSymbol }: UsdAmountProps) {
  return <CurrencyAmount amount={amount} tokenSymbol={tokenSymbol} />;
}
