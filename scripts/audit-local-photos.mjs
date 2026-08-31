import { spawnSync } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(
  process.env.LOCAL_PHOTO_FIXTURE_DIR ?? resolve(repositoryRoot, "test_photos"),
);
const maximumHeaderBytes = 1024 * 1024;

function assertLocalOnlyDirectory() {
  const fromRepository = relative(repositoryRoot, fixtureRoot);
  const insideRepository =
    fromRepository === "" ||
    (!fromRepository.startsWith("..") && !fromRepository.includes(`..${sep}`));
  if (!insideRepository) return;
  const ignored = spawnSync("git", ["check-ignore", "-q", "--", fromRepository || "."], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  if (ignored.status !== 0) throw new Error("Local photo fixture directory must be ignored by Git");
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

function exifMetadata(bytes, start, end) {
  if (end - start < 14 || bytes.toString("ascii", start, start + 6) !== "Exif\0\0") {
    return { exif: false, gps: false, orientation: null };
  }
  const tiff = start + 6;
  const endian = bytes.toString("ascii", tiff, tiff + 2);
  if (endian !== "II" && endian !== "MM") return { exif: true, gps: false, orientation: null };
  const littleEndian = endian === "II";
  const read16 = (offset) =>
    littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const read32 = (offset) =>
    littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  if (read16(tiff + 2) !== 42) return { exif: true, gps: false, orientation: null };
  const ifdOffset = read32(tiff + 4);
  const ifd = tiff + ifdOffset;
  if (ifd < tiff || ifd + 2 > end) return { exif: true, gps: false, orientation: null };
  const entries = read16(ifd);
  let gps = false;
  let orientation = null;
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) break;
    const tag = read16(entry);
    if (tag === 0x8825) gps = true;
    if (tag === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) >= 1) {
      orientation = read16(entry + 8);
    }
  }
  return { exif: true, gps, orientation };
}

const startOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function inspectJpeg(bytes) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("invalid_soi");
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let progressive = false;
  let exif = false;
  let gps = false;
  let orientation = null;
  while (offset + 4 <= bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.byteLength) throw new Error("truncated_segment");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.byteLength) throw new Error("invalid_segment");
    const dataStart = offset + 2;
    const dataEnd = offset + length;
    if (marker === 0xe1) {
      const metadata = exifMetadata(bytes, dataStart, dataEnd);
      exif ||= metadata.exif;
      gps ||= metadata.gps;
      orientation ??= metadata.orientation;
    }
    if (startOfFrameMarkers.has(marker)) {
      if (dataEnd - dataStart < 6) throw new Error("invalid_dimensions");
      height = bytes.readUInt16BE(dataStart + 1);
      width = bytes.readUInt16BE(dataStart + 3);
      progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
    }
    offset = dataEnd;
  }
  if (width <= 0 || height <= 0) throw new Error("missing_dimensions");
  return { width, height, progressive, exif, gps, orientation };
}

async function inspectFile(path) {
  const file = await stat(path);
  if (!file.isFile()) throw new Error("not_regular_file");
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(Math.min(file.size, maximumHeaderBytes));
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
    const metadata = inspectJpeg(header.subarray(0, bytesRead));
    const tail = Buffer.alloc(Math.min(file.size, 64 * 1024));
    const tailStart = Math.max(0, file.size - tail.byteLength);
    const tailRead = await handle.read(tail, 0, tail.byteLength, tailStart);
    const eoi = tail.subarray(0, tailRead.bytesRead).lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (eoi < 0) throw new Error("missing_eoi");
    return {
      ...metadata,
      bytes: file.size,
      pixels: metadata.width * metadata.height,
      trailingBytes: tailRead.bytesRead - eoi - 2,
    };
  } finally {
    await handle.close();
  }
}

assertLocalOnlyDirectory();
const entries = await readdir(fixtureRoot, { withFileTypes: true });
if (entries.some((entry) => entry.isSymbolicLink()))
  throw new Error("Fixture directory contains symlinks");
const files = entries
  .filter((entry) => entry.isFile() && /\.jpe?g$/iu.test(entry.name))
  .map((entry) => resolve(fixtureRoot, entry.name));
if (files.length === 0) throw new Error("No JPEG fixtures found");

const results = [];
const errors = new Map();
for (let offset = 0; offset < files.length; offset += 8) {
  const batch = files.slice(offset, offset + 8);
  const inspected = await Promise.all(
    batch.map(async (path) => {
      try {
        return await inspectFile(path);
      } catch (error) {
        const code = error instanceof Error ? error.message : "unknown";
        errors.set(code, (errors.get(code) ?? 0) + 1);
        return null;
      }
    }),
  );
  results.push(...inspected.filter((result) => result !== null));
}

const sizes = results.map((result) => result.bytes);
const pixels = results.map((result) => result.pixels);
const orientations = Object.fromEntries(
  [...new Set(results.map((result) => result.orientation).filter((value) => value !== null))]
    .sort((left, right) => left - right)
    .map((value) => [
      String(value),
      results.filter((result) => result.orientation === value).length,
    ]),
);
process.stdout.write(
  `${JSON.stringify({
    files: files.length,
    validHeaders: results.length,
    errors: Object.fromEntries([...errors.entries()].sort()),
    bytes: {
      total: sizes.reduce((total, value) => total + value, 0),
      min: Math.min(...sizes),
      median: percentile(sizes, 0.5),
      p95: percentile(sizes, 0.95),
      max: Math.max(...sizes),
      over50MiB: sizes.filter((value) => value > 50 * 1024 * 1024).length,
    },
    pixels: {
      min: Math.min(...pixels),
      median: percentile(pixels, 0.5),
      p95: percentile(pixels, 0.95),
      max: Math.max(...pixels),
      over100MP: pixels.filter((value) => value > 100_000_000).length,
    },
    dimensions: {
      minWidth: Math.min(...results.map((result) => result.width)),
      maxWidth: Math.max(...results.map((result) => result.width)),
      minHeight: Math.min(...results.map((result) => result.height)),
      maxHeight: Math.max(...results.map((result) => result.height)),
    },
    progressive: results.filter((result) => result.progressive).length,
    exif: results.filter((result) => result.exif).length,
    gps: results.filter((result) => result.gps).length,
    orientations,
    trailingBytes: results.filter((result) => result.trailingBytes > 0).length,
  })}\n`,
);
if (errors.size > 0 || results.length !== files.length) process.exitCode = 1;
