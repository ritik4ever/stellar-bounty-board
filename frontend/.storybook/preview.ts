import "../src/index.css";
import { withChromatic } from "@chromatic-com/storybook";
import type { Preview } from "@storybook/react";

const preview: Preview = {
  decorators: [withChromatic],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
