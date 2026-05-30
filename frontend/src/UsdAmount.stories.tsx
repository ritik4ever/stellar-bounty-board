import type { Meta, StoryObj } from "@storybook/react";
import UsdAmount from "./UsdAmount";

/**
 * UsdAmount fetches the live XLM/USD rate on mount.
 * In Storybook the fetch will fail gracefully (component renders nothing until
 * the value resolves), so the stories below demonstrate the rendered output
 * once the async value is available.
 *
 * To see the USD label, the browser must be able to reach the Stellar Horizon
 * price endpoint, or you can mock `fetch` in a decorator.
 */
const meta: Meta<typeof UsdAmount> = {
  title: "Components/UsdAmount",
  component: UsdAmount,
  decorators: [
    (Story) => (
      <span style={{ fontSize: "1.25rem", fontFamily: "sans-serif" }}>
        250 XLM <Story />
      </span>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof UsdAmount>;

export const SmallAmount: Story = {
  args: { amount: 1 },
};

export const LargeAmount: Story = {
  args: { amount: 1000 },
};
