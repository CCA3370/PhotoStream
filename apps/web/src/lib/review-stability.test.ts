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

  it("uses 480/1920 management previews and resolves originals local-first", () => {
    const lightbox = readFileSync(lightboxPath, "utf8");
    const workspace = readFileSync(workspacePath, "utf8");

    expect(workspace).toContain('variant.kind === "photo_480"');
    expect(workspace).toContain('variant.kind === "photo_1920"');
    expect(workspace).not.toContain('variant.kind === "photo_960")?.url ??');
    expect(workspace).toContain("previewUrl: localOriginalUrl ?? previewUrl");
    expect(workspace).toContain("viewerUrl: localOriginalUrl ?? ordinaryUrl");

    expect(lightbox).toContain("resolveMediaEditSource");
    expect(lightbox).toContain('"查看原图"');
    expect(lightbox).toContain("mediaId={selected.mediaId}");
  });
});
