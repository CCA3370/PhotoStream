import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const lightboxPath = fileURLToPath(
  new URL("../components/review/review-lightbox.tsx", import.meta.url),
);
const remoteSyncPath = fileURLToPath(
  new URL("../components/review/review-remote-sync.tsx", import.meta.url),
);
const workspacePath = fileURLToPath(
  new URL("../components/review/review-workspace.tsx", import.meta.url),
);
const inspectorPath = fileURLToPath(
  new URL("../components/review/review-inspector.tsx", import.meta.url),
);
const editorPath = fileURLToPath(
  new URL("../components/review/photo-editor-dialog.tsx", import.meta.url),
);

describe("management review stability guards", () => {
  it("does not use passive React wheel prevention or signed URLs as image keys", () => {
    const source = readFileSync(lightboxPath, "utf8");

    expect(source).toContain('addEventListener("wheel", handleWheel, { passive: false })');
    expect(source).not.toContain("onWheel={");
    expect(source).not.toContain("key={displaySrc}");
    expect(source).not.toContain('key={`${selected.key}:${selected.visualRevision ?? "base"}`}');
    expect(source).toContain('selected.visualRevision ?? "base"');
  });

  it("reveals management paging buttons only near the matching canvas edge", () => {
    const source = readFileSync(lightboxPath, "utf8");

    expect(source).toContain('useState<"left" | "right" | null>(null)');
    expect(source).toContain("const edgeThreshold = Math.min(180, rect.width * 0.18)");
    expect(source).toContain('hoverNavigationSide !== "left"');
    expect(source).toContain('hoverNavigationSide !== "right"');
    expect(source).toContain('"pointer-events-none opacity-0"');
    expect(source).toContain('window.addEventListener("mousemove", handleMouseMove)');
  });

  it("keeps mouse drags from paging while preserving touch swipe handling", () => {
    const source = readFileSync(lightboxPath, "utf8");

    expect(source).toContain("allowsPhotoSwipePointer(event.pointerType)");
    expect(source).toContain("zoom <= 1");
    expect(source).toContain('gestureRef.current = { mode: "swipe", start: point }');
  });

  it("keeps management lightbox keyboard focus on the image canvas", () => {
    const source = readFileSync(lightboxPath, "utf8");

    expect(source).toContain("initialFocus={readOnly ? undefined : stageRef}");
    expect(source).toContain('event.key === "Tab"');
    expect(source).toContain("isTextEntryKeyboardTarget(event.target)");
    expect(source).not.toContain("isInteractiveKeyboardTarget");
    expect(source.indexOf("const shortcutCategory")).toBeLessThan(
      source.indexOf("isTextEntryKeyboardTarget(event.target)"),
    );
  });

  it("keeps polling updates client-side instead of refreshing the RSC page", () => {
    const source = readFileSync(remoteSyncPath, "utf8");

    expect(source).toContain("REVIEW_REMOTE_CHANGED_EVENT");
    expect(source).not.toContain("router.refresh()");
    expect(source).not.toContain("useRouter");
  });

  it("preserves open records without noisy realtime toasts", () => {
    const source = readFileSync(workspacePath, "utf8");

    expect(source).toContain("reconcileRemotePage(");
    expect(source).toContain("stableRemoteMedia(");
    expect(source).toContain("openItemKeysRef.current");
    expect(source).not.toContain("审核数据已实时同步");
    expect(source).not.toContain("当前打开的照片可能已在其他会话或操作中发生变化");
  });

  it("optimistically removes deleting media before the backend task completes", () => {
    const source = readFileSync(workspacePath, "utf8");

    expect(source).toContain("deletingKeys");
    expect(source).toContain('showNotice("已开始删除")');
    expect(source).toContain("setActiveKey(nextKey)");
    expect(source).toContain("await clientMutation");
  });

  it("uses density-aware thumbnail priorities and keeps originals on demand", () => {
    const lightbox = readFileSync(lightboxPath, "utf8");
    const workspace = readFileSync(workspacePath, "utf8");

    expect(workspace).toContain("reviewStandardLocalThumbnailOrder");
    expect(workspace).toContain("reviewStandardRemoteThumbnailOrder");
    expect(workspace).toContain("reviewCompactLocalThumbnailOrder");
    expect(workspace).toContain("reviewCompactRemoteThumbnailOrder");
    expect(workspace).toContain('"photo_960"');
    expect(workspace).toContain('"photo_480"');
    expect(workspace).toContain('"photo_240"');
    expect(workspace).toContain("photo.microPreviewBlob");
    expect(workspace).not.toContain("photo.originalBlob;\n        const viewerBlob");
    expect(workspace).toContain("localVariantOrder={");
    expect(workspace).toContain("remoteVariantOrder={");

    expect(lightbox).toContain(
      'const reviewViewerVariantOrder = ["photo_1920", "photo_960", "photo_480"] as const',
    );
    expect(lightbox).toContain("resolveMediaEditSource");
    expect(lightbox).toContain("selected.localPreferred && selected.originalSrc !== null");
    expect(lightbox).toContain('"查看原图"');
    expect(lightbox).toContain('"大图暂不可用"');
    expect(lightbox).toContain("localPhotoId={selected.localPhotoId}");
  });

  it("keeps the docked inspector compact and free of redundant media labels", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain('>图片属性</p>');
    expect(source).not.toContain("{item.title}</p>");
    expect(source).not.toContain("statusLabel(item.publicationStatus)");
    expect(source).not.toContain("{item.sourceLabel}");
    expect(source).toContain('{item.featured ? "取消精选" : "精选"}');
    expect(source).toContain('className="grid grid-cols-2 gap-2"');
    expect(source).toContain(">图片信息</h3>");
    expect(source).toContain('>尺寸</dt>');
    expect(source).toContain('>大小</dt>');
    expect(source).not.toContain(">只读信息</h3>");
    expect(source).not.toContain(">上传者</dt>");
    expect(source).not.toContain(">处理状态</dt>");
    expect(source).not.toContain(">媒体 ID</dt>");
  });

  it("docks the management inspector beside the image and opens it by default", () => {
    const lightbox = readFileSync(lightboxPath, "utf8");
    const inspector = readFileSync(inspectorPath, "utf8");
    const editor = readFileSync(editorPath, "utf8");

    expect(lightbox).toContain("useState(() => !readOnly)");
    expect(lightbox).toContain('className="flex h-full w-full overflow-hidden bg-black"');
    expect(lightbox).toContain('className="relative min-w-0 flex-1 overflow-hidden bg-black"');
    expect(lightbox).toContain("w-[clamp(11.5rem,19vw,16rem)] shrink-0");
    expect(lightbox).not.toContain("absolute inset-y-0 right-0 z-40");
    expect(lightbox).toContain("<ReviewInspector");
    expect(lightbox).toContain("                    docked");
    expect(lightbox).toContain("<PhotoEditorPanel");
    expect(inspector).toContain('"h-full min-h-0 border-l"');
    expect(editor).toContain('docked ? "border-l"');
  });
});
