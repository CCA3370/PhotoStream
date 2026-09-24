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

  it("uses gap layouts instead of space utilities", () => {
    expect(violations(/\bspace-[xy]-[^\s"'\x60]+/gu)).toEqual([]);
  });

  it("uses the shared Spinner for animated loading icons", () => {
    expect(violations(/<LoaderCircleIcon\b[^>]*animate-spin[^>]*\/>/gu)).toEqual([]);
  });
});
