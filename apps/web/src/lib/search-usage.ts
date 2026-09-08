import { publicMutation } from "@/lib/client-api";

export type SearchUsageMethod = "number" | "attributes" | "face";

export function recordSearchUsage(slug: string, method: SearchUsageMethod): void {
  void publicMutation(`/api/v1/public/albums/${slug}/analytics/search-usage`, {
    body: { method },
  }).catch(() => undefined);
}
