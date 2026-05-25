import { useEffect, useState } from "react";
import { tokenAmountToUsd } from "./utils";

interface UsdAmountProps {
  amount: number;
  tokenSymbol?: string;
}

type ConversionState =
  | { status: "loading"; value: "" }
  | { status: "ready"; value: string }
  | { status: "unavailable"; value: string }
  | { status: "unsupported"; value: "" };

export default function UsdAmount({ amount, tokenSymbol = "XLM" }: UsdAmountProps) {
  const [usdValue, setUsdValue] = useState<ConversionState>({
    status: "loading",
    value: "",
  });

  useEffect(() => {
    let active = true;
    setUsdValue({ status: "loading", value: "" });

    tokenAmountToUsd(amount, tokenSymbol).then((value) => {
      if (!active) return;
      if (value === null) {
        setUsdValue({ status: "unsupported", value: "" });
      } else if (value === "USD unavailable") {
        setUsdValue({ status: "unavailable", value });
      } else {
        setUsdValue({ status: "ready", value });
      }
    });

    return () => {
      active = false;
    };
  }, [amount, tokenSymbol]);

  if (usdValue.status === "unsupported") return null;

  if (usdValue.status === "loading") {
    return <span className="usd-amount">USD loading...</span>;
  }

  return <span className="usd-amount">({usdValue.value})</span>;
}
