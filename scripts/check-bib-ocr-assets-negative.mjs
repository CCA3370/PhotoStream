import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkBibOcrAssets } from "./check-bib-ocr-assets.mjs";

const directory = await mkdtemp(join(tmpdir(), "photostream-ocr-guard-"));
const runtimePath = "sdk/runtime.mjs";
const workerPath = "sdk/assets/worker-entry-C9UNuyOJ.js";
const manifestPath = join(directory, "manifest.json");

function entry(path, bytes) {
  return {
    path,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function writeFixture(runtime, worker, maximum = 10_000) {
  await mkdir(join(directory, "sdk/assets"), { recursive: true });
  await writeFile(join(directory, runtimePath), runtime);
  await writeFile(join(directory, workerPath), worker);
  await writeFile(
    manifestPath,
    JSON.stringify({
      files: [entry(runtimePath, runtime), entry(workerPath, worker)],
      transferSets: { fixture: [runtimePath, workerPath] },
      maximumPerDeviceGzipBytes: maximum,
    }),
  );
}

async function rejectsWith(expected, action) {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
    throw error;
  }
  throw new Error(`OCR guard accepted invalid fixture: ${expected}`);
}

try {
  const runtime = Buffer.from("export const runtime = true;\n");
  const worker = Buffer.from("export const worker = true;\n");
  await writeFixture(runtime, worker);
  await checkBibOcrAssets({ assetRoot: directory, write: () => undefined });

  await writeFile(join(directory, workerPath), Buffer.from("tampered"));
  await rejectsWith("integrity mismatch", () =>
    checkBibOcrAssets({ assetRoot: directory, write: () => undefined }),
  );

  const remoteWorker = Buffer.from("fetch('https://cdn.jsdelivr.net/model')");
  await writeFixture(runtime, remoteWorker);
  await rejectsWith("remote fallback", () =>
    checkBibOcrAssets({ assetRoot: directory, write: () => undefined }),
  );

  await writeFixture(runtime, worker, 1);
  await rejectsWith("transfer budget exceeded", () =>
    checkBibOcrAssets({ assetRoot: directory, write: () => undefined }),
  );

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files[0].path = "../escape.mjs";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await rejectsWith("invalid path", () =>
    checkBibOcrAssets({ assetRoot: directory, write: () => undefined }),
  );
  process.stdout.write("Bib OCR negative asset guard passed.\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
