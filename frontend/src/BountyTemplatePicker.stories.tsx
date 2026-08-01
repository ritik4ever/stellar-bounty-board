import type { Meta, StoryObj } from "@storybook/react";
import BountyTemplatePicker from "./BountyTemplatePicker";

const meta: Meta<typeof BountyTemplatePicker> = {
  title: "Components/BountyTemplatePicker",
  component: BountyTemplatePicker,
  argTypes: {
    onSelect: { action: "selected" },
  },
};

export default meta;
type Story = StoryObj<typeof BountyTemplatePicker>;

export const Default: Story = {
  args: {
    onSelect: () => {},
  },
};