import type { PublicMediaView } from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { SharedPhotoViewer } from "@/components/gallery/shared-photo-viewer";
import { Toaster } from "@/components/ui/toast";
import { serverApi } from "@/lib/api";

interface ShortShareView {
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly media: PublicMediaView;
}

interface ShortSharePageProps {
  readonly params: Promise<{ shareId: string }>;
}

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first === undefined || first.length === 0 ? null : first;
}

async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    firstForwardedValue(requestHeaders.get("x-forwarded-host")) ?? requestHeaders.get("host");
  if (host === null) return "https://photos.bhsy.tech";
  const protocol =
    firstForwardedValue(requestHeaders.get("x-forwarded-proto")) ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

async function loadShare(shareId: string): Promise<ShortShareView> {
  return serverApi<ShortShareView>(`/api/v1/public/shares/${encodeURIComponent(shareId)}`);
}

export async function generateMetadata({ params }: ShortSharePageProps): Promise<Metadata> {
  const { shareId } = await params;
  try {
    const share = await loadShare(shareId);
    const origin = await requestOrigin();
    const pageUrl = new URL(`/s/${encodeURIComponent(shareId)}`, origin);
    const imageUrl = new URL(
      `/api/v1/public/shares/${encodeURIComponent(shareId)}/micro-preview`,
      origin,
    );
    const description = `查看「${share.title}」活动中的这张照片`;

    return {
      title: { absolute: `${share.title}｜影像直播` },
      description,
      openGraph: {
        title: `${share.title}｜影像直播`,
        description,
        type: "website",
        url: pageUrl.toString(),
        images: [{ url: imageUrl.toString() }],
      },
    };
  } catch {
    return {};
  }
}

export default async function ShortSharePage({ params }: ShortSharePageProps) {
  const { shareId } = await params;
  const share = await loadShare(shareId);
  const dataSaver = await serverApi<DataSaverSettingView>(
    `/api/v1/public/albums/${encodeURIComponent(share.slug)}/data-saver`,
  );

  return (
    <Toaster>
      <div data-photostream-data-saver={dataSaver.enabled ? "true" : "false"} hidden />
      <SharedPhotoViewer media={share.media} shareId={shareId} slug={share.slug} />
    </Toaster>
  );
}
