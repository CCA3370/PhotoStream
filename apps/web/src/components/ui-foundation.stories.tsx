import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { UiFoundationDemo } from "@/components/ui-foundation-demo";

const meta = {
  title: "Foundation/Base UI trial surface",
  component: UiFoundationDemo,
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
} satisfies Meta<typeof UiFoundationDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
