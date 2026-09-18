export type ViewerFeedbackKind = "problem" | "suggestion" | "other" | "report";
export type ViewerReportReason =
  | "privacy"
  | "inappropriate"
  | "copyright"
  | "inaccurate"
  | "other";

export interface ViewerFeedbackItem {
  readonly id: number;
  readonly albumId: string;
  readonly albumTitle: string;
  readonly albumSlug: string;
  readonly mediaId: string | null;
  readonly mediaStatus: string | null;
  readonly kind: ViewerFeedbackKind;
  readonly reportReason: ViewerReportReason | null;
  readonly message: string;
  readonly pagePath: string | null;
  readonly createdAt: string;
}

export interface ViewerFeedbackList {
  readonly items: readonly ViewerFeedbackItem[];
  readonly latestId: number;
}

export function viewerFeedbackKindLabel(kind: ViewerFeedbackKind): string {
  if (kind === "problem") return "遇到问题";
  if (kind === "suggestion") return "改进建议";
  if (kind === "report") return "图片投诉";
  return "其他";
}

export function viewerReportReasonLabel(reason: ViewerReportReason): string {
  if (reason === "privacy") return "涉及隐私或肖像";
  if (reason === "inappropriate") return "内容不适当";
  if (reason === "copyright") return "版权或授权问题";
  if (reason === "inaccurate") return "图片或人物信息有误";
  return "其他原因";
}
