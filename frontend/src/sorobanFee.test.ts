import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateCreateBountyFee } from "./sorobanFee";
import type { CreateBountyPayload } from "./types";

const payload: CreateBountyPayload = {
  repo: "ritik4ever/stellar-stream",
  issueNumber: 48,
  title: "Create payment stream",
  summary: "Fund a stream-backed bounty.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 150,
  deadlineDays: 14,
  labels: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("estimateCreateBountyFee", () => {
  it("calls Soroban RPC simulateTransaction and formats the fee in XLM", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { minResourceFee: "12345" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const estimate = await estimateCreateBountyFee(payload, "https://rpc.example.test");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://rpc.example.test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(request.method).toBe("simulateTransaction");
    expect(request.params.transaction).toEqual(expect.any(String));
    expect(estimate).toEqual({ feeStroops: 12345, feeXlm: "0.0012345" });
  });
});
