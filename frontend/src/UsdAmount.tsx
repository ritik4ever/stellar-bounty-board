import { useEffect, useState } from "react";
import { xlmToUsd } from "./utils";

interface UsdAmountProps {
  amount: number;
  tokenSymbol?: string;
}

export default function UsdAmount({ amount, tokenSymbol = "XLM" }: UsdAmountProps) {
  const [usdValue, setUsdValue] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    if (tokenSymbol.toUpperCase() === "USDC") {
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
      setUsdValue(formatted);
      setIsLoading(false);
      return;
    }

    xlmToUsd(amount)
      .then((value) => {
        if (active) {
          setUsdValue(value);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [amount, tokenSymbol]);

  if (isLoading) {
    return <span className="usd-amount">(Loading...)</span>;
  }

  if (!usdValue) return null;

  return <span className="usd-amount">({usdValue})</span>;
}
