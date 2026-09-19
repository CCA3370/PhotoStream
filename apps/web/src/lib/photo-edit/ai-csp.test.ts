import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workerPath = fileURLToPath(new URL("../../workers/photo-edit-ai.worker.ts", import.meta.url));
const runtimePath = fileURLToPath(new URL("./ai-runtime.ts", import.meta.url));
const bibPath = fileURLToPath(new URL("../bib-ocr.ts", import.meta.url));
const editWorkerPath = fileURLToPath(
  new URL("../../workers/photo-edit.worker.ts", import.meta.url),
);
const provisionPath = fileURLToPath(
  new URL("../../../../../scripts/provision-photo-edit-models.mjs", import.meta.url),
);

describe("strict CSP local inference", () => {
  it("uses only the CSP-safe WASM ONNX Runtime for photo editing", () => {
    const source = readFileSync(workerPath, "utf8");

    expect(source).toContain('import("onnxruntime-web/wasm")');
    expect(source).toContain('executionProviders: ["wasm"]');
    expect(source).toContain("ort-wasm-simd-threaded.mjs");
    expect(source).not.toContain("onnxruntime-web/webgpu");
    expect(source).not.toContain("requestAdapter");
    expect(source).not.toContain("powerPreference");
    expect(source).not.toContain('"webgpu"');
  });

  it("does not require WebGPU to expose local AI controls", () => {
    const source = readFileSync(runtimePath, "utf8");

    expect(source).toContain('typeof OffscreenCanvas !== "undefined"');
    expect(source).not.toContain('"gpu" in navigator');
  });

  it("forces OCR onto the CSP-safe WASM backend in every build", () => {
    const source = readFileSync(bibPath, "utf8");

    expect(source).toContain('backend: "wasm"');
    expect(source).not.toContain('backend: "auto"');
  });

  it("marks repeated Canvas2D readback contexts as read-heavy", () => {
    const source = readFileSync(editWorkerPath, "utf8");

    expect(source).toContain('getContext("2d", { alpha: true, willReadFrequently: true })');
  });

  it("pins and rejects dynamic execution in the production WASM glue asset", () => {
    const source = readFileSync(provisionPath, "utf8");

    expect(source).toContain('"ort/ort-wasm-simd-threaded.mjs"');
    expect(source).toContain('source.includes("new Function")');
    expect(source).toContain('source.includes("eval(")');
  });
});
