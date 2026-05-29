import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  listBounties: vi.fn(),
  listOpenIssues: vi.fn().mockResolvedValue([]),
  refundBounty: vi.fn(),
  releaseBounty: vi.fn(),
  reserveBounty: vi.fn(),
  submitBounty: vi.fn(),
}));

vi.mock("./recommendations", () => ({
  createDefaultProfile: () => ({
    preferredTokens: [],
    skills: [],
    minReward: 0,
    maxEstimatedHours: 0,
  }),
  generateRecommendations: () => [],
  updateProfileFromBounties: (profile: unknown) => profile,
}));

vi.mock("./RecommendedBounties", () => ({
  default: () => null,
}));

import * as api from "./api";
import App from "./App";
import { Bounty } from "./types";

const makeBounty = (index: number): Bounty => ({
  id: `BNTY-${index}`,
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: index + 1,
  title: `Virtual bounty ${index}`,
  summary: "A performance test bounty",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 100,
  labels: [],
  status: "open",
  createdAt: 1_700_000_000 + index,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  globalThis.ResizeObserver = class ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const height = target.classList?.contains("board-list--virtual") ? 800 : 360;
      this.callback(
        [
          {
            target,
            contentRect: {
              bottom: height,
              height,
              left: 0,
              right: 1200,
              top: 0,
              width: 1200,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ],
        this,
      );
    }

    unobserve() {}

    disconnect() {}
  };

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.classList?.contains("board-list--virtual") ? 800 : 0;
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(this: HTMLElement) {
    const height = this.classList?.contains("board-list--virtual") ? 800 : 360;
    return {
      bottom: height,
      height,
      left: 0,
      right: 1200,
      top: 0,
      width: 1200,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
  });
});

describe("virtualized bounty board", () => {
  it("only mounts the visible bounty cards plus overscan for large lists", async () => {
    vi.mocked(api.listBounties).mockResolvedValue(
      Array.from({ length: 500 }, (_, index) => ({
        ...makeBounty(index),
        repo: `ritik4ever/stellar-bounty-board-${Math.floor(index / 50)}`,
      })),
    );

    const { container } = render(<App />);

    const board = await screen.findByLabelText("Bounty board with 500 bounties");
    fireEvent.scroll(board, { target: { scrollTop: 0 } });

    const viewportHeight = 800;
    const estimatedCardHeight = 360;
    const overscan = 5;
    const maxMountedCards = Math.ceil(viewportHeight / estimatedCardHeight) + overscan * 2 + 5;

    await waitFor(() => {
      const mountedCards = container.querySelectorAll(".bounty-card");
      expect(mountedCards.length).toBeGreaterThan(0);
      expect(mountedCards.length).toBeLessThanOrEqual(maxMountedCards);
    });

    expect(screen.queryAllByText(/^Virtual bounty /)).toHaveLength(container.querySelectorAll(".bounty-card").length);
  });
});
