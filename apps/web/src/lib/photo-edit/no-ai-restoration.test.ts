import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

describe("photo editor restoration removal", () => {
  it("keeps photo-edit recipes deterministic-only", () => {
    const recipe = readFileSync(
      fileURLToPath(new URL("./recipe.ts", import.meta.url)),
      "utf8",
    );
    expect(recipe).not.toMatch(/denoise|deblur/i);
    expect(recipe).toContain('photoEditPipelineVersion = "local-edit-v3"');
  });

  it("does not ship the removed restoration runtime or model provisioner", () => {
    const removed = [
      "src/lib/photo-edit/ai-models.ts",
      "src/lib/photo-edit/ai-runtime.ts",
      "src/lib/photo-edit/ai-tiling.ts",
      "src/workers/photo-edit-ai.worker.ts",
      "public/assets/models/photo-edit/THIRD_PARTY_NOTICES.txt",
    ];
    for (const relative of removed) {
      expect(existsSync(`${webRoot}/${relative}`)).toBe(false);
    }
    expect(existsSync(`${repositoryRoot}/scripts/provision-photo-edit-models.mjs`)).toBe(false);
    expect(existsSync(`${repositoryRoot}/.github/workflows/photo-edit-models.yml`)).toBe(false);
  });

  it("preserves the bib OCR runtime and its ONNX dependency", () => {
    const packageJson = JSON.parse(readFileSync(`${webRoot}/package.json`, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.["@paddleocr/paddleocr-js"]).toBe("0.4.2");
    expect(packageJson.dependencies?.["onnxruntime-web"]).toBe("1.24.3");
    expect(existsSync(`${repositoryRoot}/scripts/build-bib-ocr-runtime.mjs`)).toBe(true);
    expect(
      existsSync(
        `${webRoot}/public/assets/models/bib-ocr/ppocrv6-tiny-0.4.2-ff6ab415-1e13b227/manifest.json`,
      ),
    ).toBe(true);
  });
});
