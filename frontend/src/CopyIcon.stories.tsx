import type { Meta, StoryObj } from "@storybook/react";
import CopyIcon from "./CopyIcons";

const meta: Meta<typeof CopyIcon> = {
  title: "Components/CopyIcon",
  component: CopyIcon,
  argTypes: {
    text: { control: "text" },
    label: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof CopyIcon>;

export const Default: Story = {
  args: {
    text: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE1234567890",
    label: "bounty ID",
  },
};

export const NoLabel: Story = {
  args: {
    text: "some-text-to-copy",
  },
};
