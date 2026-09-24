import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile()) return [];
    if (!/\.(?:css|tsx)$/u.test(entry.name)) return [];
    if (/\.(?:stories|test)\.tsx?$/u.test(entry.name)) return [];
    return [path];
  });
}

function violations(pattern: RegExp, files = sourceFiles(srcRoot)): string[] {
  return files.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(pattern)].map((match) => {
      const line = source.slice(0, match.index).split("\n").length;
      return `${relative(srcRoot, path)}:${line}: ${match[0].replace(/\s+/gu, " ").slice(0, 160)}`;
    });
  });
}

function source(path: string): string {
  return readFileSync(resolve(srcRoot, path), "utf8");
}

describe("UI governance", () => {
  it("keeps Dialog layout behavior explicit", () => {
    const dialog = source("components/ui/dialog.tsx");

    expect(dialog).not.toContain("className.includes");
    expect(dialog).toContain('padding?: "default" | "none"');
    expect(dialog).toContain('presentation?: "center" | "mobile-bottom-sheet"');
  });

  it("uses primitives instead of hand-built share modals or sibling CSS hacks", () => {
    const share = source("components/gallery/photo-share-button.tsx");

    expect(share).not.toContain("createPortal(");
    expect(share).not.toContain('role="alertdialog"');
    expect(share).not.toContain("<style>");
    expect(share).not.toContain(":has(svg.lucide-download)");
    expect(share).toContain("<Dialog open={copyNoticeOpen}");
  });

  it("keeps viewer child portals above viewer surfaces", () => {
    const errorDialog = source("components/ui/error-dialog.tsx");
    const share = source("components/gallery/photo-share-button.tsx");
    const report = source("components/gallery/photo-report-button.tsx");
    const download = source("components/gallery/download-button.tsx");
    const like = source("components/gallery/photo-like-button.tsx");
    const faceSearch = source("components/gallery/face-search-panel.tsx");
    const bibSearch = source("components/gallery/bib-search-panel.tsx");
    const reviewLightbox = source("components/review/review-lightbox.tsx");
    const reviewInspector = source("components/review/review-inspector.tsx");

    expect(errorDialog).toContain("nested?: boolean");
    expect(errorDialog).toContain("layer-nested-dialog");
    expect(errorDialog).toContain("layer-nested-dialog-overlay");
    expect(share).toContain("layer-nested-dialog");
    expect(report).toContain("layer-nested-dialog");
    expect(download).toContain('nested={variant === "lightbox"}');
    expect(like).toContain('nested={mode === "toolbar"}');
    expect(faceSearch).toContain("<ErrorDialog message={error} nested");
    expect(bibSearch).toContain("<ErrorDialog message={error} nested");
    expect(reviewLightbox).toContain("<BibReviewDialog");
    expect(reviewLightbox).toContain("          nested");
    expect(reviewInspector).toContain(
      'positionerClassName={docked ? "layer-nested-popover" : undefined}',
    );
  });

  it("does not use user-facing labels or icon implementation classes as component APIs", () => {
    const onboarding = source("components/gallery/viewer-onboarding.tsx");
    const filters = source("components/gallery/gallery-filter-nav.tsx");
    const help = source("components/gallery/viewer-help-feedback.tsx");
    const shell = source("components/shells/public-gallery-shell.tsx");

    expect(onboarding).not.toContain('querySelector("svg.lucide');
    expect(onboarding).not.toMatch(/querySelector[^\n]+button\[aria-label/u);
    expect(filters).not.toContain("svg.lucide-search");
    expect(help).not.toContain('button[aria-label="重新查看使用引导"]');
    expect(shell).not.toMatch(/button\[aria-label=/u);
  });

  it("keeps application overlay layers named and centralized", () => {
    expect(violations(/\bz-\[\d+\]/gu)).toEqual([]);
  });

  it("does not expose raw technical errors in public gallery UI", () => {
    const galleryRoot = resolve(srcRoot, "components/gallery");
    expect(
      violations(
        /\b(?:caught|error|cause)\s+instanceof\s+Error\s+\?\s+(?:caught|error|cause)\.message/gu,
        sourceFiles(galleryRoot),
      ),
    ).toEqual([]);
  });

  it("uses gap layouts instead of space utilities", () => {
    expect(violations(/\bspace-[xy]-[^\s"'\x60]+/gu)).toEqual([]);
  });

  it("uses the shared Spinner for animated loading icons", () => {
    const spinnerPath = resolve(srcRoot, "components/ui/spinner.tsx");
    expect(
      violations(
        /<LoaderCircleIcon\b[^>]*animate-spin[^>]*\/>/gu,
        sourceFiles(srcRoot).filter((path) => path !== spinnerPath),
      ),
    ).toEqual([]);
  });
});
