import { useState, useEffect, useCallback, type ChangeEvent } from "react";

interface AmountInputProps {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  id?: string;
}

/**
 * Formats a raw numeric string by adding thousands separators and
 * preserving exactly one decimal point.
 *
 * Examples:
 *   "1200"     → "1,200"
 *   "1500.50"  → "1,500.50"
 *   "0"        → "0"
 *   ""         → ""
 */
function formatDisplay(raw: string): string {
  // Strip non-digit, non-dot characters
  let cleaned = raw.replace(/[^\d.]/g, "");

  // Ensure at most one decimal point
  const dotIndex = cleaned.indexOf(".");
  if (dotIndex !== -1) {
    const before = cleaned.slice(0, dotIndex + 1);
    const after = cleaned.slice(dotIndex + 1).replace(/\./g, "");
    cleaned = before + after;
  }

  // Split into integer and fractional parts
  const parts = cleaned.split(".");
  const intPart = parts[0] ?? "";

  // Add thousands separators to integer part
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return parts.length === 2 ? `${formattedInt}.${parts[1]}` : formattedInt;
}

/**
 * Parses the formatted display string back to a clean number.
 * Strips commas and handles empty / edge cases.
 */
function parseInputValue(formatted: string): number {
  const cleaned = formatted.replace(/,/g, "");
  if (cleaned === "" || cleaned === ".") return 0;
  return Number(cleaned);
}

/**
 * Cleans pasted text so only digits and at most one dot remain.
 * Strips currency symbols, spaces, and other non-numeric characters.
 */
function sanitizePastedText(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, "");
  const dotIndex = cleaned.indexOf(".");
  if (dotIndex === -1) return cleaned;
  return cleaned.slice(0, dotIndex + 1) + cleaned.slice(dotIndex + 1).replace(/\./g, "");
}

export default function AmountInput({ value, onChange, placeholder, id }: AmountInputProps) {
  const [displayValue, setDisplayValue] = useState(() => {
    return value > 0 ? formatDisplay(String(value)) : "";
  });

  // Sync display value when the external value prop changes
  useEffect(() => {
    setDisplayValue(value > 0 ? formatDisplay(String(value)) : "");
  }, [value]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;

      // Allow clearing the input
      if (raw === "") {
        setDisplayValue("");
        onChange(0);
        return;
      }

      const formatted = formatDisplay(raw);
      setDisplayValue(formatted);
      onChange(parseInputValue(formatted));
    },
    [onChange],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text/plain");
      const sanitized = sanitizePastedText(pasted);

      if (sanitized === "") return;

      const formatted = formatDisplay(sanitized);
      setDisplayValue(formatted);
      onChange(parseInputValue(formatted));
    },
    [onChange],
  );

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onPaste={handlePaste}
      placeholder={placeholder ?? "0"}
    />
  );
}