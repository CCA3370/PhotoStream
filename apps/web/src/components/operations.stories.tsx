import type {
  AlbumStatistics,
  AlbumView,
  AuditLogList,
  InternalMediaView,
} from "@photostream/contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AlbumSettings } from "@/components/albums/album-settings";
import { AuditLogTable } from "@/components/audit/audit-log-table";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { UserManagement } from "@/components/users/user-management";

const meta = {
  title: "Operations/Stage 3 workflows",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const albumId = "019d0000-0000-7000-8000-000000000101";
const uploaderId = "019d0000-0000-7000-8000-000000000102";
const categoryId = "019d0000-0000-7000-8000-000000000103";
const createdAt = "2026-08-29T00:00:00.000Z";

function mediaFixture(
  id: string,
  publicationStatus: InternalMediaView["publicationStatus"],
  deletionTask: InternalMediaView["deletionTask"] = null,
): InternalMediaView {
  return {
    id,
    albumId,
    uploaderId,
    categoryId,
    kind: "photo",
    ingestStatus: "ready",
    publicationStatus,
    width: 640,
    height: 480,
    totalBytes: 128_000,
    capturedAt: null,
    publishSequence: publicationStatus === "pending_review" ? null : 1,
    publishedAt: publicationStatus === "pending_review" ? null : createdAt,
    variants: [
      {
        kind: "photo_480",
        url: "/storybook-media-placeholder.svg",
        width: 480,
        height: 360,
        bytes: 24_000,
        contentType: "image/webp",
      },
    ],
    deletionTask,
    createdAt,
  };
}

export const ReviewAndRecover: Story = {
  render: () => (
    <ReviewWorkspace
      albumId={albumId}
      albumTitle="春季运动会"
      categories={[{ id: categoryId, name: "田径" }]}
      initialPage={{
        items: [
          mediaFixture("019d0000-0000-7000-8000-000000000111", "pending_review"),
          mediaFixture("019d0000-0000-7000-8000-000000000112", "hidden", {
            id: "019d0000-0000-7000-8000-000000000113",
            status: "failed",
            attempts: 2,
            lastErrorCode: "CDN_INVALIDATION_FAILED",
          }),
        ],
        nextCursor: null,
      }}
      uploaders={[{ id: uploaderId, username: "photo.teacher", displayName: "摄影老师" }]}
      userRole="admin"
    />
  ),
};

const album: AlbumView = {
  id: albumId,
  slug: "storybook-album",
  title: "春季运动会",
  description: "虚构活动设置夹具",
  state: "live",
  access: "password",
  publishMode: "review",
  previewDownloadEnabled: false,
  originalDownloadEnabled: false,
  videoDownloadEnabled: false,
  privacyNotice: "仅用于校内活动记录。",
  complaintContact: "校内影像管理员",
  createdAt,
  updatedAt: createdAt,
};

const statistics: AlbumStatistics = {
  mediaCount: 48,
  logicalBytes: 24_000_000,
  opens: 120,
  sessions: 80,
  downloads: 0,
  uniqueVisitors: 64,
  daily: [
    {
      day: "2026-08-29",
      opens: 120,
      sessions: 80,
      downloads: 0,
      uniqueVisitors: 64,
    },
  ],
};

export const SettingsAndStatistics: Story = {
  render: () => <AlbumSettings initialAlbum={album} statistics={statistics} />,
};

export const Members: Story = {
  render: () => (
    <UserManagement
      initialUsers={[
        {
          id: "019d0000-0000-7000-8000-000000000121",
          username: "school.admin",
          displayName: "系统管理员",
          role: "admin",
          isActive: true,
          mustChangePassword: false,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: "019d0000-0000-7000-8000-000000000122",
          username: "review.teacher",
          displayName: "审核老师",
          role: "reviewer",
          isActive: false,
          mustChangePassword: false,
          createdAt,
          updatedAt: createdAt,
        },
      ]}
    />
  ),
};

const audit: AuditLogList = {
  items: [
    {
      id: 2,
      actorUserId: "019d0000-0000-7000-8000-000000000121",
      action: "media.deletion.failed",
      targetType: "media",
      targetId: "019d0000-0000-7000-8000-000000000112",
      result: "failed",
      changedFields: ["deletionTask"],
      createdAt,
    },
    {
      id: 1,
      actorUserId: "019d0000-0000-7000-8000-000000000121",
      action: "media.published",
      targetType: "media",
      targetId: "019d0000-0000-7000-8000-000000000111",
      result: "success",
      changedFields: ["publicationStatus", "publishSequence"],
      createdAt,
    },
  ],
  nextCursor: null,
};

export const Audit: Story = {
  render: () => <AuditLogTable initial={audit} />,
};
