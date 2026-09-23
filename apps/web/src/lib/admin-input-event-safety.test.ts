import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const componentsRoot = fileURLToPath(new URL("../components", import.meta.url));
const excludedDirectories = new Set(["gallery", "ui"]);
const directDomValueAccess = /\.(?:currentTarget|target)\.(?:value|valueAsNumber|checked|files|selectedOptions)\b/gu;
const escapedNewlineInJsxHandler = /on[A-Z][A-Za-z]*=\{[^\n]*=>\s*\{\\n\s*(?:const|let|set|void|if|return)\b/gu;

function managementComponentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === componentsRoot && excludedDirectories.has(entry.name)) return [];
      return managementComponentFiles(path);
    }
    return entry.isFile() && /\.tsx$/u.test(entry.name) ? [path] : [];
  });
}

describe("management input event safety", () => {
  it("snapshots DOM input values before state or async callbacks", () => {
    const violations = managementComponentFiles(componentsRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [directDomValueAccess, escapedNewlineInJsxHandler].flatMap((pattern) =>
        [...source.matchAll(pattern)].map((match) => {
          const line = source.slice(0, match.index).split("\n").length;
          return `${path.slice(dirname(componentsRoot).length + 1)}:${line}: ${match[0]}`;
        }),
      );
    });

    expect(violations).toEqual([]);
  });
});
