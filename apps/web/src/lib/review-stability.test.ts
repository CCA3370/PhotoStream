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
    expect(source).toContain('selected.visualRevision ?? "base"');
  });

  it("keeps polling updates client-side instead of refreshing the RSC page", () => {
    const source = readFileSync(remoteSyncPath, "utf8");

    expect(source).toContain("REVIEW_REMOTE_CHANGED_EVENT");
    expect(source).not.toContain("router.refresh()");
    expect(source).not.toContain("useRouter");
  });

  it("preserves open records and stabilizes signed variant URLs during list reconciliation", () => {
    const source = readFileSync(workspacePath, "utf8");

    expect(source).toContain("reconcileRemotePage(");
    expect(source).toContain("stableRemoteMedia(");
    expect(source).toContain("openItemKeysRef.current");
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

  it("docks the management inspector beside the image and opens it by default", () => {
    const lightbox = readFileSync(lightboxPath, "utf8");
    const inspector = readFileSync(inspectorPath, "utf8");
    const editor = readFileSync(editorPath, "utf8");

    expect(lightbox).toContain("useState(() => !readOnly)");
    expect(lightbox).toContain('className="flex h-full w-full overflow-hidden bg-black"');
    expect(lightbox).toContain('className="relative min-w-0 flex-1 overflow-hidden bg-black"');
    expect(lightbox).toContain("w-[clamp(17rem,32vw,24rem)] shrink-0");
    expect(lightbox).not.toContain("absolute inset-y-0 right-0 z-40");
    expect(lightbox).toContain("<ReviewInspector");
    expect(lightbox).toContain("                    docked");
    expect(lightbox).toContain("<PhotoEditorPanel");
    expect(inspector).toContain('"h-full min-h-0 border-l"');
    expect(editor).toContain('docked ? "border-l"');
  });
});
