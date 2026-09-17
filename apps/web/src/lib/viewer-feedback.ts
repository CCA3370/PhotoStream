export type ViewerFeedbackKind = "problem" | "suggestion" | "other";

export interface ViewerFeedbackItem {
  readonly id: number;
  readonly albumId: string;
  readonly albumTitle: string;
  readonly kind: ViewerFeedbackKind;
  readonly message: string;
  readonly pagePath: string | null;
  readonly createdAt: string;
}

export interface ViewerFeedbackList {
  readonly items: readonly ViewerFeedbackItem[];
  readonly latestId: number;
}

export const viewerFeedbackCreatedEvent = "photostream:viewer-feedback-created";

export function viewerFeedbackKindLabel(kind: ViewerFeedbackKind): string {
  if (kind === "problem") return "遇到问题";
  if (kind === "suggestion") return "改进建议";
  return "其他";
}
