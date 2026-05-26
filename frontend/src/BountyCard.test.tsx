import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BountyCard from "./BountyCard";
import { actionCopy, statusCopy } from "./constants";
import type { Bounty } from "./types";

const baseBounty: Bounty = {
  id: "BNTY-312",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 312,
  title: "Prevent bounty card re-renders",
  summary: "Memoize bounty cards when polling refreshes unchanged data.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contributor: undefined,
  tokenSymbol: "XLM",
  amount: 150,
  labels: [{ name: "frontend", color: "ededed" }],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: Math.floor(Date.now() / 1000) + 86_400,
  version: 1,
  events: [],
};

describe("BountyCard memoization", () => {
  it("does not re-render when polling returns an unchanged bounty object", () => {
    const renderActionButton = vi.fn(() => null);
    const onOpen = vi.fn();
    const { rerender } = render(
      <BountyCard
        bounty={baseBounty}
        statusCopy={statusCopy}
        actionCopy={actionCopy}
        renderActionButton={renderActionButton}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText(baseBounty.title)).toBeInTheDocument();
    expect(renderActionButton).toHaveBeenCalledTimes(1);

    rerender(
      <BountyCard
        bounty={{ ...baseBounty, version: baseBounty.version + 1, events: [{ type: "created", timestamp: 1 }] }}
        statusCopy={statusCopy}
        actionCopy={actionCopy}
        renderActionButton={renderActionButton}
        onOpen={onOpen}
      />,
    );

    expect(renderActionButton).toHaveBeenCalledTimes(1);
  });

  it("re-renders when a visible bounty field changes", () => {
    const renderActionButton = vi.fn(() => null);
    const onOpen = vi.fn();
    const { rerender } = render(
      <BountyCard
        bounty={baseBounty}
        statusCopy={statusCopy}
        actionCopy={actionCopy}
        renderActionButton={renderActionButton}
        onOpen={onOpen}
      />,
    );

    rerender(
      <BountyCard
        bounty={{ ...baseBounty, title: "Updated bounty title" }}
        statusCopy={statusCopy}
        actionCopy={actionCopy}
        renderActionButton={renderActionButton}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("Updated bounty title")).toBeInTheDocument();
    expect(renderActionButton).toHaveBeenCalledTimes(2);
  });
});
