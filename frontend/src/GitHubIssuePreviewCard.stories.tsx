import type { Meta, StoryObj } from "@storybook/react";
import GitHubIssuePreviewCard from "./GitHubIssuePreviewCard";

const meta: Meta<typeof GitHubIssuePreviewCard> = {
  title: "Components/GitHubIssuePreviewCard",
  component: GitHubIssuePreviewCard,
  argTypes: {
    repo: { control: "text" },
    issueNumber: { control: "number" },
    title: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof GitHubIssuePreviewCard>;

export const Default: Story = {
  args: {
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 305,
    title: "Add Storybook for all reusable frontend components",
    labels: [
      { name: "enhancement", color: "84b6eb" },
      { name: "good first issue", color: "7057ff" },
    ],
  },
};

export const NoLabels: Story = {
  args: {
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 1,
    title: "Fix typo in README",
    labels: [],
  },
};

export const ManyLabels: Story = {
  args: {
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 42,
    title: "Implement wallet-authenticated maintainer actions",
    labels: [
      { name: "enhancement", color: "84b6eb" },
      { name: "help wanted", color: "008672" },
      { name: "priority: high", color: "e11d48" },
      { name: "wave-4", color: "f97316" },
    ],
  },
};

export const InvalidRepo: Story = {
  args: {
    repo: "not-a-valid-repo",
    issueNumber: 0,
    title: "Placeholder",
    labels: [],
  },
};
