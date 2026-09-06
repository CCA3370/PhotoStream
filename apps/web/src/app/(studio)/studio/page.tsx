import type { AlbumSummaryView } from "@photostream/contracts";

import { type DashboardStatistics, DashboardView } from "@/components/dashboard/dashboard-view";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function StudioPage() {
  await requireInternalSession();
  const [albums, statistics] = await Promise.all([
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
    serverApi<DashboardStatistics>("/api/v1/dashboard?limit=8"),
  ]);

  return <DashboardView albums={albums} initialData={statistics} />;
}
