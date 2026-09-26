import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const galleryPagePath = fileURLToPath(
  new URL("../app/(public)/g/[slug]/page.tsx", import.meta.url),
);
const galleryNotFoundPath = fileURLToPath(
  new URL("../app/(public)/g/[slug]/not-found.tsx", import.meta.url),
);

describe("public gallery not-found handling", () => {
  it("routes album 404 responses to the gallery not-found boundary", () => {
    const source = readFileSync(galleryPagePath, "utf8");

    expect(source).toContain("error instanceof ApiRequestError && error.status === 404");
    expect(source).toContain("notFound()");
    expect(source).toContain("publicAlbumApi<PublicAlbumView>");
  });

  it("renders scheduled draft albums as pre-start activities instead of not-found", () => {
    const source = readFileSync(galleryPagePath, "utf8");
    const draftBranch = source.indexOf('if (album.state === "draft")');
    const accessBranch = source.indexOf("if (album.accessRequired)");

    expect(draftBranch).toBeGreaterThan(-1);
    expect(accessBranch).toBeGreaterThan(draftBranch);
    expect(source).toContain('status="未开始"');
    expect(source).toContain("开始时间（北京时间）");
    expect(source).toContain("ScheduledAlbumAutoRefresh");
    expect(source).toContain("scheduledStartAt={album.scheduledStartAt} slug={slug}");
    expect(source).toContain("活动开始后，此页面会自动更新并显示直播照片。");
  });

  it("renders an audience-facing activity-not-found page", () => {
    const source = readFileSync(galleryNotFoundPath, "utf8");

    expect(source).toContain("活动不存在");
    expect(source).toContain("该活动可能已结束服务、已被删除，或访问链接有误。");
    expect(source).toContain('href="/"');
    expect(source).not.toContain("页面暂时无法加载");
  });
});
