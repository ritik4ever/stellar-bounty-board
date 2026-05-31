import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock("./api", () => ({
  createBounty: vi.fn(),
  exportReleasedPayoutsCsv: vi.fn(),
  getBounty: vi.fn(),
  listBounties: vi.fn().mockResolvedValue([]),
  listOpenIssues: vi.fn().mockResolvedValue([]),
  refundBounty: vi.fn(),
  releaseBounty: vi.fn(),
  reserveBounty: vi.fn(),
  submitBounty: vi.fn(),
}));

vi.mock("./sorobanFee", () => ({
  estimateCreateBountyFee: vi.fn(),
}));

vi.mock("./recommendations", () => ({
  createDefaultProfile: () => ({
    skills: [],
    completedLabels: [],
    preferredRepos: [],
    averageRewardRange: { min: 0, max: Number.MAX_SAFE_INTEGER },
  }),
  generateRecommendations: vi.fn(() => []),
  updateProfileFromBounties: vi.fn((profile) => profile),
}));

import * as api from "./api";
import App from "./App";
import { estimateCreateBountyFee } from "./sorobanFee";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listBounties).mockResolvedValue([]);
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);
  vi.mocked(api.createBounty).mockResolvedValue(undefined);
  vi.mocked(estimateCreateBountyFee).mockResolvedValue({
    feeStroops: 12345,
    feeXlm: "0.0012345",
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("create bounty fee preview", () => {
  it("simulates the Soroban transaction and shows the estimated fee before confirmation", async () => {
    render(<App />);

    await screen.findByRole("button", { name: /preview fee/i });
    await userEvent.click(screen.getByRole("button", { name: /preview fee/i }));

    expect(estimateCreateBountyFee).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 150,
        tokenSymbol: "XLM",
      }),
    );
    expect(api.createBounty).not.toHaveBeenCalled();

    expect(await screen.findByText("Network fee estimate")).toBeInTheDocument();
    expect(screen.getByText("150 XLM")).toBeInTheDocument();
    expect(screen.getByText("10.7143 XLM/day")).toBeInTheDocument();
    expect(screen.getByText("0.0012345 XLM")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => expect(api.createBounty).toHaveBeenCalledTimes(1));
  });

  it("shows an inline error when Soroban simulation fails", async () => {
    vi.mocked(estimateCreateBountyFee).mockRejectedValueOnce(new Error("RPC unavailable"));

    render(<App />);

    await screen.findByRole("button", { name: /preview fee/i });
    await userEvent.click(screen.getByRole("button", { name: /preview fee/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("RPC unavailable");
    expect(api.createBounty).not.toHaveBeenCalled();
  });
});
