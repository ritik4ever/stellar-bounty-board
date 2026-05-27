import { useEffect, useState } from "react";
import { xlmToUsd } from "./xlmUsd";

interface UsdAmountProps {
  amount: number;
}

export default function UsdAmount({ amount }: UsdAmountProps) {
  const [usdValue, setUsdValue] = useState<string>("");

  useEffect(() => {
    let active = true;
    xlmToUsd(amount).then((value) => {
      if (active) setUsdValue(value);
    });
    return () => {
      active = false;
    };
  }, [amount]);

  if (!usdValue) return null;

  return <span className="usd-amount">({usdValue})</span>;
}
