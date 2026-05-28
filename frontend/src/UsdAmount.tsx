import { useEffect, useState } from "react";
import { xlmToUsd } from "./utils";

interface UsdAmountProps {
  amount: number;
  tokenSymbol?: string;
}

export default function UsdAmount({ amount, tokenSymbol = "XLM" }: UsdAmountProps) {
  const [usdValue, setUsdValue] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const normalizedToken = tokenSymbol.toUpperCase();

    if (normalizedToken !== "XLM" && normalizedToken !== "USDC") {
      setUsdValue("");
      return () => {
        active = false;
      };
    }

    setUsdValue(null);
    xlmToUsd(amount, normalizedToken).then((value) => {
      if (active) setUsdValue(value);
    });
    return () => {
      active = false;
    };
  }, [amount, tokenSymbol]);

  if (usdValue === "") return null;

  if (usdValue === null) {
    return <span className="usd-amount">(Loading USD...)</span>;
  }

  return <span className="usd-amount">({usdValue})</span>;
}
