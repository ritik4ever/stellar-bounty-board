import type { Meta, StoryObj } from "@storybook/react";
import BountyCard from "./BountyCard";
import { statusCopy, actionCopy } from "./constants";
import type { Bounty, BountyStatus } from "./types";

// ---------------------------------------------------------------------------
// Mock data factory
// ---------------------------------------------------------------------------

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: "BNTY-001",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 42,
    title: "Add dark mode toggle",
    summary:
      "Implement a dark mode toggle that persists the user's preference across sessions. The toggle should be accessible, respect system preference, and animate smoothly.",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contributor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK",
    tokenSymbol: "XLM",
    amount: 500,
    labels: [
      { name: "enhancement", color: "a2eeef" },
      { name: "frontend", color: "1d76db" },
    ],
    status: "open" as BountyStatus,
    createdAt: 1_700_000_000,
    deadlineAt: 1_700_086_400,
    version: 1,
    events: [],
    ...overrides,
  };
}

const openBounty = makeBounty();
const reservedBounty = makeBounty({
  status: "reserved",
  reservedAt: 1_700_050_000,
  contributor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK",
});
const submittedBounty = makeBounty({
  status: "submitted",
  submittedAt: 1_700_070_000,
  contributor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK",
  submissionUrl: "https://github.com/ritik4ever/stellar-bounty-board/pull/43",
});
const releasedBounty = makeBounty({
  status: "released",
  releasedAt: 1_700_080_000,
  releasedTxHash: "a1b2c3d4e5f6...",
  contributor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK",
});
const refundedBounty = makeBounty({
  status: "refunded",
  refundedAt: 1_700_080_000,
  refundedTxHash: "f6e5d4c3b2a1...",
});
const expiredBounty = makeBounty({
  status: "expired",
  deadlineAt: 1_690_000_000,
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof BountyCard> = {
  title: "Components/BountyCard",
  component: BountyCard,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 480, width: "100%" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onOpen: (id: string) => console.log("Open bounty:", id),
    renderActionButton: (bounty: Bounty, action) => (
      <button
        key={action.action}
        type="button"
        className="primary-button"
        title={action.title}
        onClick={() => console.log(`${action.action} bounty ${bounty.id}`)}
      >
        {action.label}
      </button>
    ),
  },
};

export default meta;
type Story = StoryObj<typeof BountyCard>;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const Open: Story = {
  args: { bounty: openBounty },
};

export const Reserved: Story = {
  args: { bounty: reservedBounty },
};

export const Submitted: Story = {
  args: { bounty: submittedBounty },
};

export const Released: Story = {
  args: { bounty: releasedBounty },
};

export const Refunded: Story = {
  args: { bounty: refundedBounty },
};

export const Expired: Story = {
  args: { bounty: expiredBounty },
};

export const ManyLabels: Story = {
  args: {
    bounty: makeBounty({
      labels: [
        { name: "enhancement", color: "a2eeef" },
        { name: "frontend", color: "1d76db" },
        { name: "good first issue", color: "7057ff" },
        { name: "help wanted", color: "008672" },
        { name: "bug", color: "d73a4a" },
      ],
    }),
  },
};

export const USDCBounty: Story = {
  args: {
    bounty: makeBounty({
      tokenSymbol: "USDC",
      amount: 100,
    }),
  },
};