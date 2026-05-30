import type { Meta, StoryObj } from "@storybook/react";
import SkeletonBountyCard from "./SkeletonBountyCard";

const meta: Meta<typeof SkeletonBountyCard> = {
  title: "Components/SkeletonBountyCard",
  component: SkeletonBountyCard,
};

export default meta;
type Story = StoryObj<typeof SkeletonBountyCard>;

export const Default: Story = {};

export const Multiple: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 480 }}>
      <SkeletonBountyCard />
      <SkeletonBountyCard />
      <SkeletonBountyCard />
    </div>
  ),
};
