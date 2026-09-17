import { ViewerFeedbackInbox } from "@/components/feedback/viewer-feedback-inbox";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";
import type { ViewerFeedbackList } from "@/lib/viewer-feedback";

export default async function ViewerFeedbackPage() {
  await requireInternalSession();
  const feedback = await serverApi<ViewerFeedbackList>("/api/v1/feedback?limit=100");

  return (
    <ViewerFeedbackInbox
      initialItems={feedback.items}
      initialLatestId={feedback.latestId}
    />
  );
}
