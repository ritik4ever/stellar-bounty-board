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

  it("shows a loading state while the XLM price is fetched", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<UsdAmount amount={10} tokenSymbol="XLM" />);

    expect(screen.getByText("(loading USD...)")).toBeInTheDocument();
  });

  it("fetches the XLM/USD price and renders the converted amount", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.125 } }),
    });

    render(<UsdAmount amount={80} tokenSymbol="XLM" />);

    expect(await screen.findByText("($10.00)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the cached XLM rate for subsequent renders", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.2 } }),
    });

    const { rerender } = render(<UsdAmount amount={10} tokenSymbol="XLM" />);
    expect(await screen.findByText("($2.00)")).toBeInTheDocument();

    rerender(<UsdAmount amount={25} tokenSymbol="XLM" />);

    expect(await screen.findByText("($5.00)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the last known XLM price when refresh fails", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stellar: { usd: 0.5 } }),
    });

    const { unmount } = render(<UsdAmount amount={10} tokenSymbol="XLM" />);
    expect(await screen.findByText("($5.00)")).toBeInTheDocument();
    unmount();

    nowSpy.mockReturnValue(1_000 + 5 * 60 * 1000 + 1);
    fetchMock.mockRejectedValueOnce(new Error("network unavailable"));

    render(<UsdAmount amount={20} tokenSymbol="XLM" />);

    await waitFor(() => expect(screen.getByText("($10.00)")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("renders USDC at a 1:1 USD rate without fetching", () => {
    render(<UsdAmount amount={42.5} tokenSymbol="USDC" />);

    expect(screen.getByText("($42.50)")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
