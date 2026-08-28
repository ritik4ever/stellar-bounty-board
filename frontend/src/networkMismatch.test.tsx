import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bounty } from "./types";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock("./api", () => ({
  createBounty: vi.fn(),
  getBounty: vi.fn(),
  listBounties: vi.fn(),
  listOpenIssues: vi.fn(),
  releaseBountySigned: vi.fn(),
  refundBountySigned: vi.fn(),
  reserveBounty: vi.fn(),
  submitBounty: vi.fn(),
}));

import * as api from "./api";
import App from "./App";
import NetworkMismatchBanner from "./components/NetworkMismatchBanner";

const MAINTAINER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CONTRIBUTOR = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY";

const submittedBounty: Bounty = {
  id: "BNTY-300",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 300,
  title: "Bounty awaiting release",
  summary: "A submitted bounty.",
  maintainer: MAINTAINER,
  contributor: CONTRIBUTOR,
  tokenSymbol: "USDC",
  amount: 150,
  labels: [],
  status: "submitted",
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

function mockBrowserApis() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockFreighter({ correctNetwork }: { correctNetwork: boolean }) {
  const networkPassphrase = correctNetwork
    ? "Test SDF Network ; September 2015"
    : "Public Global Stellar Network ; September 2015";
  (window as unknown as { freighter?: unknown }).freighter = {
    isConnected: vi.fn().mockResolvedValue({ isConnected: true }),
    getPublicKey: vi.fn().mockResolvedValue(MAINTAINER),
    getNetwork: vi.fn().mockResolvedValue({
      network: correctNetwork ? "TESTNET" : "PUBLIC",
      networkPassphrase,
    }),
    signMessage: vi.fn().mockResolvedValue({ signature: "sig" }),
    setNetwork: vi.fn().mockResolvedValue(undefined),
  };
}

async function renderBoard() {
  vi.mocked(api.listBounties).mockResolvedValue([submittedBounty]);
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);
  vi.mocked(api.getBounty).mockResolvedValue(submittedBounty);

  const result = render(<App />);
  await waitFor(() => expect(screen.getByText("Bounty awaiting release")).toBeInTheDocument());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBrowserApis();
  window.history.pushState(null, "", "/");
  window.prompt = vi.fn();
  window.alert = vi.fn();
  delete (window as unknown as { freighter?: unknown }).freighter;
});

describe("NetworkMismatchBanner", () => {
  it("shows the wallet network and the expected network", () => {
    render(<NetworkMismatchBanner walletNetwork="PUBLIC" />);
    expect(screen.getByText(/Wrong Stellar network detected/i)).toBeInTheDocument();
    expect(screen.getByText("PUBLIC")).toBeInTheDocument();
    expect(screen.getByText("TESTNET")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Freighter help center/i })).toHaveAttribute(
      "href",
      expect.stringContaining("help.freighter.app")
    );
  });
});

describe("wallet network mismatch handling", () => {
  it("renders the mismatch banner and disables mutating actions when wallet is on the wrong network", async () => {
    mockFreighter({ correctNetwork: false });
    const user = (await import("@testing-library/user-event")).default.setup();
    await renderBoard();

    expect(screen.getByText(/Wrong Stellar network detected/i)).toBeInTheDocument();

    const releaseButton = screen.getByRole("button", { name: "Release" });
    const refundButton = screen.getByRole("button", { name: "Refund" });
    expect(releaseButton).toBeDisabled();
    expect(refundButton).toBeDisabled();

    await user.click(releaseButton);
    expect(api.releaseBountySigned).not.toHaveBeenCalled();
  });

  it("does not render the banner or disable actions when wallet is on the correct network", async () => {
    mockFreighter({ correctNetwork: true });
    await renderBoard();

    expect(screen.queryByText(/Wrong Stellar network detected/i)).not.toBeInTheDocument();

    const releaseButton = screen.getByRole("button", { name: "Release" });
    expect(releaseButton).toBeEnabled();
  });

  it("does not render the banner when no wallet is connected", async () => {
    await renderBoard();

    expect(screen.queryByText(/Wrong Stellar network detected/i)).not.toBeInTheDocument();
    const releaseButton = screen.getByRole("button", { name: "Release" });
    expect(releaseButton).toBeEnabled();
  });
});
