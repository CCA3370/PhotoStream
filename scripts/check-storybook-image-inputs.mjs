import { open, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([
  ".git",
  ".local-data",
  ".next",
  ".pnpm-store",
  "dist",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);
const forbiddenExtensions = new Set([".avif", ".heic", ".heif", ".icns", ".jxl"]);
const isoBrands = new Set([
  "avif",
  "avis",
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

function ascii(bytes, start, length) {
  return Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
}

function forbiddenMagic(bytes) {
  if (ascii(bytes, 0, 4) === "icns") return "ICNS";
  if (bytes[0] === 0xff && bytes[1] === 0x0a) return "JXL codestream";
  if (
    bytes.length >= 12 &&
    bytes
      .subarray(0, 12)
      .equals(Buffer.from([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 13, 10, 0x87, 10]))
  ) {
    return "JXL container";
  }
  if (ascii(bytes, 4, 4) === "ftyp" && isoBrands.has(ascii(bytes, 8, 4))) {
    return "HEIF/AVIF container";
  }
  return null;
}

async function inspect(path) {
  const extension = extname(path).toLowerCase();
  if (forbiddenExtensions.has(extension)) return `forbidden extension ${extension}`;
  const file = await open(path, "r");
  try {
    const bytes = Buffer.alloc(32);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return forbiddenMagic(bytes.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}

async function walk(directory, findings) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await walk(path, findings);
      continue;
    }
    if (!entry.isFile()) continue;
    const reason = await inspect(path);
    if (reason !== null) findings.push(`${relative(repositoryRoot, path)}: ${reason}`);
  }
}

const findings = [];
await walk(repositoryRoot, findings);
if (findings.length > 0) {
  process.stderr.write(
    `Storybook image input guard rejected files handled by unpatched image-size parsers:\n${findings.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Storybook image input guard passed.\n");
}
