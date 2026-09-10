import { type DashboardStatistics, DashboardView } from "@/components/dashboard/dashboard-view";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function StudioPage() {
  await requireInternalSession();
  const statistics = await serverApi<DashboardStatistics>("/api/v1/dashboard?limit=20");

  return <DashboardView initialData={statistics} />;
}