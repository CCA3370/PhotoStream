export type ViewerFeedbackKind = "problem" | "suggestion" | "other" | "report";
export type ViewerReportReason =
  | "privacy"
  | "inappropriate"
  | "copyright"
  | "inaccurate"
  | "malicious_spread"
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
  if (reason === "privacy") return "侵犯了我的隐私或肖像权";
  if (reason === "inappropriate") return "图片中有不适合公开的内容";
  if (reason === "copyright") return "未经授权使用了我的作品或图片";
  if (reason === "inaccurate") return "图片中的人物或信息有误";
  if (reason === "malicious_spread") return "这张图片被他人恶意传播或扩散";
  return "其他需要处理的问题";
}
