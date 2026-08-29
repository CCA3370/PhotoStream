import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const assetRoot = resolve(
  root,
  "apps/web/public/assets/models/bib-ocr/ppocrv6-tiny-0.4.2-ff6ab415-1e13b227",
);
const manifest = JSON.parse(await readFile(resolve(assetRoot, "manifest.json"), "utf8"));
let transferMaximum = 0;
const contents = new Map();
for (const file of manifest.files) {
  const bytes = await readFile(resolve(assetRoot, file.path));
  contents.set(file.path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== file.bytes || digest !== file.sha256) {
    throw new Error(`Bib OCR asset integrity mismatch: ${file.path}`);
  }
}
for (const path of ["sdk/runtime.mjs", "sdk/assets/worker-entry-C9UNuyOJ.js"]) {
  const source = contents.get(path)?.toString("utf8") ?? "";
  for (const forbiddenHost of ["cdn.jsdelivr.net", "paddle-model-ecology.bj.bcebos.com"]) {
    if (source.includes(forbiddenHost)) {
      throw new Error(`Bib OCR runtime contains a remote fallback: ${path} -> ${forbiddenHost}`);
    }
  }
}
for (const [name, paths] of Object.entries(manifest.transferSets)) {
  const compressedBytes = paths.reduce((total, path) => {
    const bytes = contents.get(path);
    if (bytes === undefined)
      throw new Error(`Bib OCR transfer set references unknown file: ${path}`);
    return total + gzipSync(bytes, { level: 9 }).byteLength;
  }, 0);
  transferMaximum = Math.max(transferMaximum, compressedBytes);
  process.stdout.write(`Bib OCR ${name} gzip transfer: ${compressedBytes} bytes.\n`);
}
if (transferMaximum > manifest.maximumPerDeviceGzipBytes) {
  throw new Error(`Bib OCR per-device transfer budget exceeded: ${transferMaximum}`);
}
process.stdout.write(
  `Bib OCR asset guard passed (${manifest.files.length} files, max ${transferMaximum} bytes).\n`,
);
