import { useEffect, useState } from "react";
import { xlmToUsd, xlmToEur } from "./utils";

export type DisplayCurrency = "USD" | "EUR" | "XLM";

const CURRENCY_KEY = "stellar-bounty-board-currency";

function getPreferredCurrency(): DisplayCurrency {
  try {
    const stored = localStorage.getItem(CURRENCY_KEY);
    if (stored === "USD" || stored === "EUR" || stored === "XLM") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "USD";
}

function setPreferredCurrency(currency: DisplayCurrency): void {
  try {
    localStorage.setItem(CURRENCY_KEY, currency);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent("currencychange", { detail: currency }));
}

interface UsdAmountProps {
  amount: number;
  tokenSymbol?: string;
  showSelector?: boolean;
}

export default function UsdAmount({ amount, tokenSymbol = "XLM", showSelector = false }: UsdAmountProps) {
  const [currency, setCurrency] = useState<DisplayCurrency>(getPreferredCurrency);
  const [usdValue, setUsdValue] = useState<string>("");
  const [eurValue, setEurValue] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Listen for currency changes from other instances
  useEffect(() => {
    function handleCurrencyChange(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail === "USD" || detail === "EUR" || detail === "XLM") {
        setCurrency(detail);
      }
    }
    window.addEventListener("currencychange", handleCurrencyChange);
    return () => window.removeEventListener("currencychange", handleCurrencyChange);
  }, []);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    if (tokenSymbol.toUpperCase() === "USDC") {
      // USDC is always 1:1 with USD
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
      setUsdValue(formatted);
      setEurValue("");
      setIsLoading(false);
      return;
    }

    // Fetch both USD and EUR values
    Promise.all([xlmToUsd(amount), xlmToEur(amount)])
      .then(([usd, eur]) => {
        if (active) {
          setUsdValue(usd);
          setEurValue(eur);
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

  const handleCurrencyChange = (next: DisplayCurrency) => {
    setCurrency(next);
    setPreferredCurrency(next);
  };

  const currencyDisplay = (() => {
    if (isLoading) return "(Loading...)";
    if (tokenSymbol.toUpperCase() === "USDC") {
      // USDC only has USD value
      if (currency === "USD" || currency === "EUR") return `(${usdValue})`;
      return `(${amount} USDC)`;
    }
    if (currency === "EUR" && eurValue) return `(${eurValue})`;
    if (currency === "XLM") return `(${amount} XLM)`;
    if (usdValue) return `(${usdValue})`;
    return null;
  })();

  return (
    <span className="usd-amount" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {currencyDisplay}
      {showSelector && (
        <select
          value={currency}
          onChange={(e) => handleCurrencyChange(e.target.value as DisplayCurrency)}
          className="currency-selector"
          aria-label="Display currency"
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: "0.75rem",
            padding: "1px 4px",
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="XLM">XLM</option>
        </select>
      )}
    </span>
  );
}