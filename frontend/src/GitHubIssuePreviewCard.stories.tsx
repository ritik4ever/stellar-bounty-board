import type { Meta, StoryObj } from "@storybook/react";
import GitHubIssuePreviewCard from "./GitHubIssuePreviewCard";

const meta: Meta<typeof GitHubIssuePreviewCard> = {
  title: "Components/GitHubIssuePreviewCard",
  component: GitHubIssuePreviewCard,
  argTypes: {
    repo: { control: "text" },
    issueNumber: { control: "number" },
  },
};

export default meta;
type Story = StoryObj<typeof GitHubIssuePreviewCard>;

export const Default: Story = {
  args: {
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 305,
  },
};

export const InvalidRepo: Story = {
  args: {
    repo: "not-a-valid-repo",
    issueNumber: 0,
  },
};
