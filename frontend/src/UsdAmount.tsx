import { useEffect, useState } from "react";
import { getXlmRate } from "./utils";

interface UsdAmountProps {
  amount: number;
  tokenSymbol?: string;
}

const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function UsdAmount({ amount, tokenSymbol = "XLM" }: UsdAmountProps) {
  const normalizedToken = tokenSymbol.toUpperCase();
  const [usdValue, setUsdValue] = useState<string | null>(
    normalizedToken === "USDC" ? formatUsd(amount) : null,
  );
  const [isLoading, setIsLoading] = useState(normalizedToken === "XLM");

  useEffect(() => {
    let active = true;

    if (normalizedToken === "USDC") {
      setUsdValue(formatUsd(amount));
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    if (normalizedToken !== "XLM") {
      setUsdValue(null);
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    getXlmRate().then((rate) => {
      if (!active) return;
      setUsdValue(rate === null ? null : formatUsd(amount * rate));
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [amount, normalizedToken]);

  if (isLoading) return <span className="usd-amount">(loading USD...)</span>;
  if (!usdValue) return null;

  return <span className="usd-amount">({usdValue})</span>;
}
