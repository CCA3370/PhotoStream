import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const galleryPagePath = fileURLToPath(
  new URL("../app/(public)/g/[slug]/page.tsx", import.meta.url),
);

describe("shared photo route isolation", () => {
  it("returns the shared viewer before mounting gallery notices or onboarding", () => {
    const source = readFileSync(galleryPagePath, "utf8");
    const sharedViewer = source.indexOf("<SharedPhotoViewer");
    const serviceNotice = source.indexOf("<ViewerServiceNotice");
    const onboarding = source.indexOf("<ViewerOnboarding");

    expect(sharedViewer).toBeGreaterThan(-1);
    expect(serviceNotice).toBeGreaterThan(sharedViewer);
    expect(onboarding).toBeGreaterThan(sharedViewer);
  });

  it("keeps both photo and share parameters required for the isolated shared view", () => {
    const source = readFileSync(galleryPagePath, "utf8");

    expect(source).toContain("query.photo !== undefined && query.share !== undefined");
  });
});
