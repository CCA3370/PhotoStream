import type {
  AlbumStatistics,
  AlbumView,
  AuditLogList,
  BibConfigView,
  BibMediaState,
  FaceConfigView,
  InternalMediaView,
} from "@photostream/contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AlbumSettings } from "@/components/albums/album-settings";
import { AuditLogTable } from "@/components/audit/audit-log-table";
import { BibConfigEditor } from "@/components/bib/bib-config-editor";
import { BibSearchPanel } from "@/components/gallery/bib-search-panel";
import { FaceSearchPanel } from "@/components/gallery/face-search-panel";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { UserManagement } from "@/components/users/user-management";

const meta = {
  title: "Operations/Stage 4 workflows",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const albumId = "019d0000-0000-7000-8000-000000000101";
const uploaderId = "019d0000-0000-7000-8000-000000000102";
const categoryId = "019d0000-0000-7000-8000-000000000103";
const gradeOptionId = "019d0000-0000-7000-8000-000000000104";
const classOptionId = "019d0000-0000-7000-8000-000000000105";
const createdAt = "2026-08-29T00:00:00.000Z";

function mediaFixture(
  id: string,
  publicationStatus: InternalMediaView["publicationStatus"],
  deletionTask: InternalMediaView["deletionTask"] = null,
  bib?: BibMediaState,
): InternalMediaView {
  return {
    id,
    albumId,
    uploaderId,
    categoryId,
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
    ...(bib === undefined ? {} : { bib }),
    createdAt,
  };
}

export const ReviewAndRecover: Story = {
  render: () => (
    <ReviewWorkspace
      albumId={albumId}
      albumTitle="春季运动会"
      bibConfig={bibConfig}
      categories={[{ id: categoryId, name: "田径" }]}
      initialPage={{
        items: [
          mediaFixture("019d0000-0000-7000-8000-000000000111", "pending_review", null, {
            tags: [
              {
                id: "019d0000-0000-7000-8000-000000000114",
                mediaId: "019d0000-0000-7000-8000-000000000111",
                number: "101999",
                status: "suggested",
                source: "ocr",
                confidence: 0.91,
                quadrilateral: [
                  { x: 0.2, y: 0.3 },
                  { x: 0.5, y: 0.3 },
                  { x: 0.5, y: 0.45 },
                  { x: 0.2, y: 0.45 },
                ],
                ruleVersion: 1,
                modelVersion: "ppocrv6-tiny-0.4.2-ff6ab415-1e13b227",
                gradeOptionId: null,
                classOptionId: null,
                mappingVersion: 1,
                createdAt,
                confirmedAt: null,
              },
            ],
            review: {
              mediaId: "019d0000-0000-7000-8000-000000000111",
              decision: "pending",
              ocrStatus: "completed",
              ocrModelVersion: "ppocrv6-tiny-0.4.2-ff6ab415-1e13b227",
              decidedAt: null,
            },
          }),
          mediaFixture(
            "019d0000-0000-7000-8000-000000000112",
            "hidden",
            {
              id: "019d0000-0000-7000-8000-000000000113",
              status: "failed",
              attempts: 2,
              lastErrorCode: "CDN_INVALIDATION_FAILED",
            },
            {
              tags: [],
              review: {
                mediaId: "019d0000-0000-7000-8000-000000000112",
                decision: "no_number_confirmed",
                ocrStatus: "failed",
                ocrModelVersion: "ppocrv6-tiny-0.4.2-ff6ab415-1e13b227",
                decidedAt: createdAt,
              },
            },
          ),
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

const bibConfig: BibConfigView = {
  albumId,
  automationStatus: "experimental",
  recognitionEnabled: true,
  searchEnabled: true,
  modelVersion: "ppocrv6-tiny-0.4.2-ff6ab415-1e13b227",
  patterns: [
    {
      id: "019d0000-0000-7000-8000-000000000131",
      totalLength: 6,
      sortOrder: 0,
      enabled: true,
      constraints: [
        {
          id: "019d0000-0000-7000-8000-000000000132",
          startPosition: 1,
          width: 3,
          sortOrder: 0,
          ranges: [{ start: "101", end: "112" }],
        },
      ],
    },
  ],
  attributeOptions: [
    { id: gradeOptionId, dimension: "grade", displayName: "初一", sortOrder: 0, enabled: true },
    { id: classOptionId, dimension: "class", displayName: "一班", sortOrder: 0, enabled: true },
  ],
  mappings: [
    {
      id: "019d0000-0000-7000-8000-000000000133",
      dimension: "grade",
      startPosition: 1,
      width: 1,
      ranges: [{ start: "1", end: "1" }],
      outputOptionId: gradeOptionId,
      sortOrder: 0,
    },
    {
      id: "019d0000-0000-7000-8000-000000000134",
      dimension: "class",
      startPosition: 2,
      width: 2,
      ranges: [{ start: "01", end: "01" }],
      outputOptionId: classOptionId,
      sortOrder: 0,
    },
  ],
  ruleVersion: 1,
  mappingVersion: 1,
  ruleUsable: true,
  mappingUsable: true,
  recalculationStatus: "idle",
  issues: [],
  updatedAt: createdAt,
};

const faceConfig: FaceConfigView = {
  albumId,
  enabled: false,
  readyToEnable: false,
  noticeVersion: "face-notice-2026-08-31",
  thresholdVersion: "unqualified",
  indexState: "disabled",
  authorizationConfirmedAt: null,
  retentionDays: 30,
  readiness: {
    participantConsentRecordsConfirmed: false,
    guardianConsentRequirementsConfirmed: false,
    impactAssessmentCompleted: false,
    providerResourcesValidated: false,
    evaluationGatePassed: false,
    billingAlertsConfigured: false,
    indexedFacesAuthorized: false,
    globalFeatureEnabled: false,
    passwordAccess: true,
    privacyNoticeConfigured: true,
    complaintContactConfigured: true,
    noticeVersionCurrent: false,
    thresholdVersionQualified: false,
  },
  counts: { pending: 0, indexed: 0, failed: 0, excluded: 0 },
  lastIndexedAt: null,
  lastClusteredAt: null,
  deletionDueAt: null,
  lastErrorCode: null,
};

export const SettingsAndStatistics: Story = {
  render: () => (
    <AlbumSettings
      bibConfig={bibConfig}
      faceConfig={faceConfig}
      initialAlbum={album}
      statistics={statistics}
    />
  ),
};

export const BibRuleAndMappingEditor: Story = {
  render: () => <BibConfigEditor initial={bibConfig} />,
};

export const PublicBibSearch: Story = {
  render: () => (
    <BibSearchPanel
      attributeFilterEnabled
      attributeOptions={bibConfig.attributeOptions}
      attributePairs={[
        { gradeOptionId, classOptionId: null },
        { gradeOptionId, classOptionId },
      ]}
      numberLengths={[6]}
      slug="storybook-bib-album"
    >
      <div className="min-h-48 rounded-xl border bg-muted p-6">普通相册流占位</div>
    </BibSearchPanel>
  ),
};

export const FaceSearchConsent: Story = {
  render: () => (
    <div className="public-theme min-h-screen bg-background">
      <FaceSearchPanel
        complaintContact="校内影像管理员"
        noticeVersion="face-notice-2026-08-31"
        onClose={() => undefined}
        privacyNotice="参考照仅用于本相册短期候选检索。"
        slug="storybook-face-album"
      />
    </div>
  ),
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
