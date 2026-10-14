/**
 * Token amount formatting with decimal normalization.
 *
 * Different tokens use different decimal places:
 * - XLM: 7 decimals
 * - USDC: 2 decimals (on Stellar; 6 on Ethereum)
 * - Unknown tokens: 7 decimals (safe fallback)
 */

const DECIMAL_MAP: Record<string, number> = {
  XLM: 7,
  USDC: 2,
  USDT: 2,
};

const DEFAULT_DECIMALS = 7;

function getDecimals(tokenSymbol: string): number {
  return DECIMAL_MAP[tokenSymbol.toUpperCase()] ?? DEFAULT_DECIMALS;
}

/**
 * Format an amount with the correct decimal places for the given token.
 * Handles both raw integers and display amounts.
 */
export function formatAmount(amount: number, tokenSymbol: string): string {
  const decimals = getDecimals(tokenSymbol);

  // If the amount has more decimals than the token supports, round down
  const factor = 10 ** decimals;
  const displayAmount = Math.floor(amount * factor) / factor;

  return displayAmount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Convert raw on-chain amount (in smallest unit) to display amount.
 * For example, 1000000 stroops → 0.1 XLM (XLM has 7 decimals).
 */
export function fromRawUnits(rawAmount: number, tokenSymbol: string): number {
  const decimals = getDecimals(tokenSymbol);
  return rawAmount / 10 ** decimals;
}

/**
 * Convert display amount to raw on-chain units.
 */
export function toRawUnits(amount: number, tokenSymbol: string): number {
  const decimals = getDecimals(tokenSymbol);
  return Math.round(amount * 10 ** decimals);
}

/**
 * Display an amount with its token symbol, properly formatted.
 * Returns "0 XLM", "1,234.56 USDC", etc.
 */
export function formatAmountWithToken(
  amount: number,
  tokenSymbol: string,
): string {
  return `${formatAmount(amount, tokenSymbol)} ${tokenSymbol.toUpperCase()}`;
}
