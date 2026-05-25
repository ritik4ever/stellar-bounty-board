import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsdAmount from "./UsdAmount";
import { resetXlmToUsdCache } from "./utils";

describe("UsdAmount", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetXlmToUsdCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a loading state before resolving live XLM/USD conversion", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.125 } }),
    });

    render(<UsdAmount amount={40} tokenSymbol="XLM" />);

    expect(screen.getByText("USD loading...")).toBeInTheDocument();
    expect(await screen.findByText("($5.00)")).toBeInTheDocument();
  });

  it("renders USDC amounts as 1:1 USD values without fetching a price", async () => {
    render(<UsdAmount amount={12.34} tokenSymbol="USDC" />);

    expect(await screen.findByText("($12.34)")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
