import { useEffect, useState } from "react";
import { xlmToUsd } from "./utils";

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

  return (
    <span
      className="usd-amount"
      aria-hidden={!usdValue ? "true" : undefined}
    >
      {usdValue ? `(${usdValue})` : ""}
    </span>
  );
}
