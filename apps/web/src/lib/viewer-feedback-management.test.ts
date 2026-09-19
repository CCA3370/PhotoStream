import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const inboxPath = fileURLToPath(
  new URL("../components/feedback/viewer-feedback-inbox.tsx", import.meta.url),
);
const lightboxPath = fileURLToPath(
  new URL("../components/review/review-lightbox.tsx", import.meta.url),
);

describe("viewer feedback management", () => {
  it("restores hidden reported media with the restore endpoint", () => {
    const source = readFileSync(inboxPath, "utf8");

    expect(source).toContain('visible ? "restore" : "hide"');
    expect(source).not.toContain('visible ? "publish" : "hide"');
  });

  it("deletes complaint records through the protected feedback API", () => {
    const source = readFileSync(inboxPath, "utf8");

    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("/api/v1/feedback/");
    expect(source).toContain("删除投诉记录");
  });

  it("reuses ReviewLightbox in readonly mode", () => {
    const inbox = readFileSync(inboxPath, "utf8");
    const lightbox = readFileSync(lightboxPath, "utf8");

    expect(inbox).toContain("<ReviewLightbox");
    expect(inbox).toContain("readOnly");
    expect(lightbox).toContain("readOnly = false");
    expect(lightbox).toContain("!readOnly && !bibConfirmed");
    expect(lightbox).toContain("selected.localPreferred ? selected.mediaId : null");
  });
});
