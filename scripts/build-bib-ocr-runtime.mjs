import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sdkPackageRoot = await realpath(
  resolve(repositoryRoot, "apps/web/node_modules/@paddleocr/paddleocr-js"),
);
const yamlPackageRoot = await realpath(resolve(sdkPackageRoot, "../../js-yaml"));
const ortPackageRoot = await realpath(
  resolve(repositoryRoot, "apps/web/node_modules/onnxruntime-web"),
);
const output = resolve(
  repositoryRoot,
  "apps/web/public/assets/models/bib-ocr/ppocrv6-tiny-0.4.2-ff6ab415-1e13b227/sdk",
);
const publicAssetBase = "/assets/models/bib-ocr/ppocrv6-tiny-0.4.2-ff6ab415-1e13b227";

function disableRemoteFallbacks(source, label) {
  const rewritten = source
    .replaceAll(
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/",
      `${publicAssetBase}/ort/`,
    )
    .replace(
      /https:\/\/paddle-model-ecology\.bj\.bcebos\.com\/paddlex\/official_inference_model\/paddle3\.0\.0\/[^"'`\s]+\.tar/gu,
      `${publicAssetBase}/remote-model-fallback-disabled`,
    );
  for (const forbiddenHost of ["cdn.jsdelivr.net", "paddle-model-ecology.bj.bcebos.com"]) {
    if (rewritten.includes(forbiddenHost)) {
      throw new Error(`Remote OCR fallback remains in ${label}: ${forbiddenHost}`);
    }
  }
  return rewritten;
}

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "assets"), { recursive: true });
await mkdir(resolve(output, "vendor"), { recursive: true });

let runtime = await readFile(resolve(sdkPackageRoot, "dist/index.mjs"), "utf8");
runtime = disableRemoteFallbacks(
  runtime
    .replace('import yaml from "js-yaml";', 'import yaml from "./vendor/js-yaml.mjs";')
    .replace(
      'import ClipperLib from "clipper-lib";',
      'import ClipperLib from "./vendor/clipper-stub.mjs";',
    )
    .replace(
      'import cvModule from "@techstark/opencv-js";',
      'import cvModule from "./vendor/opencv-stub.mjs";',
    )
    .replace('import("onnxruntime-web")', 'import("./vendor/ort-stub.mjs")'),
  "runtime.mjs",
);
for (const forbidden of [
  'from "js-yaml"',
  'from "clipper-lib"',
  'from "@techstark/opencv-js"',
  'import("onnxruntime-web")',
]) {
  if (runtime.includes(forbidden)) throw new Error(`Unrewritten OCR runtime import: ${forbidden}`);
}
runtime += `\n// PhotoStream worker-only bridge; direct main-thread inference intentionally unavailable.\n`;
runtime += `globalThis.__photostreamBibOcrRuntime = { create: (options) => PaddleOCR.create(options) };\n`;
await writeFile(resolve(output, "runtime.mjs"), runtime);

await cp(resolve(yamlPackageRoot, "dist/js-yaml.mjs"), resolve(output, "vendor/js-yaml.mjs"));
await writeFile(
  resolve(output, "vendor/clipper-stub.mjs"),
  'export default new Proxy({}, { get() { throw new Error("Clipper is unavailable on the OCR main thread"); } });\n',
);
await writeFile(
  resolve(output, "vendor/opencv-stub.mjs"),
  'export default new Proxy({}, { get() { throw new Error("OpenCV is unavailable on the OCR main thread"); } });\n',
);
await writeFile(
  resolve(output, "vendor/ort-stub.mjs"),
  'throw new Error("ONNX Runtime is unavailable on the OCR main thread");\nexport {};\n',
);
const workerFile = "worker-entry-C9UNuyOJ.js";
const worker = disableRemoteFallbacks(
  await readFile(resolve(sdkPackageRoot, "dist/assets", workerFile), "utf8"),
  workerFile,
);
await writeFile(resolve(output, "assets", workerFile), worker);
await cp(
  resolve(ortPackageRoot, "dist/ort.bundle.min.mjs"),
  resolve(output, "assets/ort.bundle.min.mjs"),
);

process.stdout.write("Built worker-only PhotoStream PaddleOCR runtime.\n");
