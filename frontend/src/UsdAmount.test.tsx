import { render, screen, waitFor } from "@testing-library/react";
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

  it("shows a loading state while fetching the XLM/USD rate", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.125 } }),
    });

    render(<UsdAmount amount={100} tokenSymbol="XLM" />);

    expect(screen.getByText("(Loading USD...)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("($12.50)")).toBeInTheDocument());
  });

  it("renders USDC bounties 1:1 without fetching the XLM/USD rate", async () => {
    render(<UsdAmount amount={25} tokenSymbol="USDC" />);

    await waitFor(() => expect(screen.getByText("($25.00)")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
