import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UsdAmount from "./UsdAmount";

vi.mock("./utils", async () => {
  const actual = await vi.importActual<typeof import("./utils")>("./utils");
  return {
    ...actual,
    xlmToUsd: vi.fn().mockResolvedValue("$1.20"),
  };
});

describe("UsdAmount component", () => {
  it("shows loading state initially", () => {
    render(<UsdAmount amount={10} tokenSymbol="XLM" />);
    expect(screen.getByText("(Loading...)")).toBeInTheDocument();
  });

  it("renders the converted amount for XLM", async () => {
    render(<UsdAmount amount={10} tokenSymbol="XLM" />);
    await waitFor(() => {
      expect(screen.getByText("($1.20)")).toBeInTheDocument();
    });
  });

  it("renders 1:1 for USDC without calling fetch/conversion", async () => {
    render(<UsdAmount amount={100} tokenSymbol="USDC" />);
    await waitFor(() => {
      expect(screen.getByText("($100.00)")).toBeInTheDocument();
    });
  });
});
