import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PublicGalleryShell } from "@/components/shells/public-gallery-shell";
import { StudioShell } from "@/components/shells/studio-shell";
import { UploadShell } from "@/components/shells/upload-shell";

const meta = {
  title: "Foundation/Interface shells",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const storyMediaIds = ["01", "02", "03", "04", "05", "06", "07", "08"];

export const PublicGallery: Story = {
  render: () => (
    <PublicGalleryShell albumTitle="春季运动会">
      <div className="grid grid-cols-2 gap-2 py-4 md:grid-cols-4">
        {storyMediaIds.map((id) => (
          <div aria-hidden="true" className="aspect-square rounded-lg bg-muted" key={id} />
        ))}
      </div>
    </PublicGalleryShell>
  ),
};

export const UploadQueue: Story = {
  render: () => (
    <UploadShell
      albumId="demo"
      albumTitle="春季运动会"
      queue={{
        paused: false,
        processing: 0,
        failed: 0,
        retryableFailed: 0,
        pendingReview: 0,
        completed: 0,
        onTogglePause: () => undefined,
        onRetryFailed: () => undefined,
        onClearCompleted: () => undefined,
      }}
    >
      <h2 className="text-xl font-semibold">上传队列为空</h2>
    </UploadShell>
  ),
};

export const StudioAdmin: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/studio" } },
  },
  render: () => (
    <StudioShell pageTitle="活动" userDisplayName="系统管理员" userRole="admin">
      <h2 className="text-xl font-semibold">活动总览</h2>
    </StudioShell>
  ),
};

export const StudioUploader: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/studio" } },
  },
  render: () => (
    <StudioShell pageTitle="活动" userDisplayName="摄影老师" userRole="uploader">
      <p>上传者不显示成员和审计入口。</p>
    </StudioShell>
  ),
};
