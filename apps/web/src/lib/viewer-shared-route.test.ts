import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const galleryPagePath = fileURLToPath(
  new URL("../app/(public)/g/[slug]/page.tsx", import.meta.url),
);
const sharePagePath = fileURLToPath(
  new URL("../app/(public)/s/[shareId]/page.tsx", import.meta.url),
);
const sharedViewerPath = fileURLToPath(
  new URL("../components/gallery/shared-photo-viewer.tsx", import.meta.url),
);

describe("shared photo route isolation", () => {
  it("renders the isolated shared viewer from the dedicated share route", () => {
    const source = readFileSync(sharePagePath, "utf8");

    expect(source).toContain("<SharedPhotoViewer");
    expect(source).not.toContain("<ViewerServiceNotice");
    expect(source).not.toContain("<ViewerOnboarding");
    expect(source).toContain(
      ["/api/v1/public/shares/", "$", "{encodeURIComponent(shareId)}"].join(""),
    );
  });

  it("keeps a complaint action on the isolated share viewer", () => {
    const source = readFileSync(sharedViewerPath, "utf8");

    expect(source).toContain("<PhotoReportButton");
    expect(source).toContain("shareId={shareId}");
  });

  it("does not keep the legacy share entrypoint in the gallery route", () => {
    const source = readFileSync(galleryPagePath, "utf8");

    expect(source).not.toContain("query.share");
    expect(source).not.toContain("<SharedPhotoViewer");
    expect(source).not.toContain("/shared/");
  });
});
