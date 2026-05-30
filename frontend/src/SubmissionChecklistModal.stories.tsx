import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import SubmissionChecklistModal from "./SubmissionChecklistModal";
import type { Bounty } from "./types";

const mockBounty: Bounty = {
  id: "bounty-001",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 42,
  title: "Add Storybook for all reusable frontend components",
  summary: "Set up Storybook and add stories for all shared components.",
  maintainer: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE1234567890",
  tokenSymbol: "XLM",
  amount: 250,
  labels: [{ name: "enhancement", color: "84b6eb" }],
  status: "reserved",
  createdAt: Date.now() - 86400000,
  deadlineAt: Date.now() + 86400000 * 7,
  version: 1,
  events: [],
};

const meta: Meta<typeof SubmissionChecklistModal> = {
  title: "Components/SubmissionChecklistModal",
  component: SubmissionChecklistModal,
  parameters: {
    // Render inside a positioned container so the dialog is visible
    layout: "fullscreen",
  },
  args: {
    bounty: mockBounty,
    submitting: false,
    error: null,
    onSubmit: fn(),
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SubmissionChecklistModal>;

export const Default: Story = {};

export const Submitting: Story = {
  args: { submitting: true },
};

export const WithError: Story = {
  args: { error: "Submission failed. Please try again." },
};

export const WithInitialData: Story = {
  args: {
    initialData: {
      contributor: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE1234567890",
      prLink: "https://github.com/ritik4ever/stellar-bounty-board/pull/99",
      testsWritten: true,
      notes: "Added stories for all 5 components.",
    },
  },
};
