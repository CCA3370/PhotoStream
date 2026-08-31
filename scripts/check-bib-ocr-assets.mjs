import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const defaultAssetRoot = resolve(
  root,
  "apps/web/public/assets/models/bib-ocr/ppocrv6-tiny-0.4.2-ff6ab415-1e13b227",
);

function assetPath(assetRoot, path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Bib OCR manifest contains an invalid path: ${String(path)}`);
  }
  return resolve(assetRoot, path);
}

export async function checkBibOcrAssets({
  assetRoot = defaultAssetRoot,
  write = (value) => process.stdout.write(value),
} = {}) {
  const manifest = JSON.parse(await readFile(resolve(assetRoot, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest.files) || typeof manifest.transferSets !== "object") {
    throw new Error("Bib OCR manifest structure is invalid");
  }
  let transferMaximum = 0;
  const contents = new Map();
  for (const file of manifest.files) {
    const bytes = await readFile(assetPath(assetRoot, file.path));
    contents.set(file.path, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== file.bytes || digest !== file.sha256) {
      throw new Error(`Bib OCR asset integrity mismatch: ${file.path}`);
    }
  }
  for (const path of ["sdk/runtime.mjs", "sdk/assets/worker-entry-C9UNuyOJ.js"]) {
    const source = contents.get(path)?.toString("utf8") ?? "";
    if (source.length === 0) throw new Error(`Bib OCR runtime file is missing: ${path}`);
    for (const forbiddenHost of ["cdn.jsdelivr.net", "paddle-model-ecology.bj.bcebos.com"]) {
      if (source.includes(forbiddenHost)) {
        throw new Error(`Bib OCR runtime contains a remote fallback: ${path} -> ${forbiddenHost}`);
      }
    }
  }
  for (const [name, paths] of Object.entries(manifest.transferSets)) {
    if (!Array.isArray(paths)) throw new Error(`Bib OCR transfer set is invalid: ${name}`);
    const compressedBytes = paths.reduce((total, path) => {
      const bytes = contents.get(path);
      if (bytes === undefined)
        throw new Error(`Bib OCR transfer set references unknown file: ${path}`);
      return total + gzipSync(bytes, { level: 9 }).byteLength;
    }, 0);
    transferMaximum = Math.max(transferMaximum, compressedBytes);
    write(`Bib OCR ${name} gzip transfer: ${compressedBytes} bytes.\n`);
  }
  if (
    !Number.isSafeInteger(manifest.maximumPerDeviceGzipBytes) ||
    transferMaximum > manifest.maximumPerDeviceGzipBytes
  ) {
    throw new Error(`Bib OCR per-device transfer budget exceeded: ${transferMaximum}`);
  }
  write(
    `Bib OCR asset guard passed (${manifest.files.length} files, max ${transferMaximum} bytes).\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkBibOcrAssets();
}
