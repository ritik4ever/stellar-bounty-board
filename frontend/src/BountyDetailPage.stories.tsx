import type { Meta, StoryObj } from "@storybook/react";
import BountyDetailPage from "./BountyDetailPage";
import { statusCopy, actionCopy } from "./constants";
import type { Bounty, BountyStatus } from "./types";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: "BNTY-001",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 42,
    title: "Add dark mode toggle",
    summary:
      "Implement a dark mode toggle that persists the user preference across sessions.",
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
    events: [
      { type: "created", timestamp: 1_700_000_000, actor: "ritik4ever" },
    ],
    ...overrides,
  };
}

const openBounty = makeBounty();
const reservedBounty = makeBounty({
  status: "reserved",
  reservedAt: 1_700_050_000,
  events: [
    { type: "created", timestamp: 1_700_000_000, actor: "ritik4ever" },
    { type: "reserved", timestamp: 1_700_050_000, actor: "contributor1" },
  ],
});
const submittedBounty = makeBounty({
  status: "submitted",
  submittedAt: 1_700_070_000,
  submissionUrl: "https://github.com/ritik4ever/stellar-bounty-board/pull/43",
  events: [
    { type: "created", timestamp: 1_700_000_000, actor: "ritik4ever" },
    { type: "reserved", timestamp: 1_700_050_000, actor: "contributor1" },
    { type: "submitted", timestamp: 1_700_070_000, actor: "contributor1" },
  ],
});
const releasedBounty = makeBounty({
  status: "released",
  releasedAt: 1_700_080_000,
  releasedTxHash: "a1b2c3d4e5f6...",
  notes: "Great work!",
  events: [
    { type: "created", timestamp: 1_700_000_000, actor: "ritik4ever" },
    { type: "reserved", timestamp: 1_700_050_000, actor: "contributor1" },
    { type: "submitted", timestamp: 1_700_070_000, actor: "contributor1" },
    { type: "released", timestamp: 1_700_080_000, actor: "ritik4ever" },
  ],
});
const refundedBounty = makeBounty({
  status: "refunded",
  refundedAt: 1_700_080_000,
  refundedTxHash: "f6e5d4c3b2a1...",
  notes: "Scope changed, refunding the bounty.",
  events: [
    { type: "created", timestamp: 1_700_000_000, actor: "ritik4ever" },
    { type: "reserved", timestamp: 1_700_050_000, actor: "contributor1" },
    { type: "refunded", timestamp: 1_700_080_000, actor: "ritik4ever" },
  ],
});
const expiredBounty = makeBounty({
  status: "expired",
  deadlineAt: 1_690_000_000,
  events: [
    { type: "created", timestamp: 1_700_000_000, actor: "ritik4ever" },
    { type: "expired", timestamp: 1_690_000_000, actor: "system" },
  ],
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof BountyDetailPage> = {
  title: "Components/BountyDetailPage",
  component: BountyDetailPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    onBack: () => console.log("Go back"),
    owner: "ritik4ever",
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    statusCopy,
    actionCopy,
    formatTimestamp: (ts?: number) => {
      if (!ts) return "N/A";
      return new Date(ts * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
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
type Story = StoryObj<typeof BountyDetailPage>;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const Loading: Story = {
  args: {
    bounty: null,
    loading: true,
  },
};

export const NotFound: Story = {
  args: {
    bounty: null,
    loading: false,
  },
};

export const Open: Story = {
  args: {
    bounty: openBounty,
    loading: false,
  },
};

export const Reserved: Story = {
  args: {
    bounty: reservedBounty,
    loading: false,
  },
};

export const Submitted: Story = {
  args: {
    bounty: submittedBounty,
    loading: false,
  },
};

export const Released: Story = {
  args: {
    bounty: releasedBounty,
    loading: false,
  },
};

export const Refunded: Story = {
  args: {
    bounty: refundedBounty,
    loading: false,
  },
};

export const Expired: Story = {
  args: {
    bounty: expiredBounty,
    loading: false,
  },
};