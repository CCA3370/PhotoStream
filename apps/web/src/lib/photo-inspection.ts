export interface DetectedPhoto {
  readonly format: "jpeg" | "png" | "webp";
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
  readonly animated: boolean;
  readonly capturedAt: string | null;
}

function isAsciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function pngAnimated(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    if (isAsciiAt(bytes, offset + 4, "acTL")) return true;
    const next = offset + 12 + length;
    if (!Number.isSafeInteger(next) || next <= offset || next > bytes.byteLength) return false;
    offset = next;
  }
  return false;
}

function webpAnimated(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const type = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
    const length = view.getUint32(offset + 4, true);
    if (type === "ANIM" || type === "ANMF") return true;
    if (type === "VP8X" && length >= 1 && ((bytes[offset + 8] ?? 0) & 0x02) !== 0) return true;
    const next = offset + 8 + length + (length % 2);
    if (!Number.isSafeInteger(next) || next <= offset || next > bytes.byteLength) return false;
    offset = next;
  }
  return false;
}

function exifAscii(
  bytes: Uint8Array,
  view: DataView,
  tiffStart: number,
  littleEndian: boolean,
  entryOffset: number,
): string | null {
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  if (type !== 2 || count < 2 || count > 64) return null;
  const valueOffset =
    count <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, littleEndian);
  if (valueOffset < 0 || valueOffset + count > bytes.byteLength) return null;
  return new TextDecoder("ascii")
    .decode(bytes.subarray(valueOffset, valueOffset + count - 1))
    .trim();
}

function exifEntries(options: {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  readonly tiffStart: number;
  readonly littleEndian: boolean;
  readonly ifdOffset: number;
}): Map<number, { readonly entryOffset: number; readonly value: string | null }> {
  const output = new Map<number, { readonly entryOffset: number; readonly value: string | null }>();
  const absoluteOffset = options.tiffStart + options.ifdOffset;
  if (absoluteOffset < 0 || absoluteOffset + 2 > options.bytes.byteLength) return output;
  const count = options.view.getUint16(absoluteOffset, options.littleEndian);
  if (count > 512 || absoluteOffset + 2 + count * 12 > options.bytes.byteLength) return output;
  for (let index = 0; index < count; index += 1) {
    const entryOffset = absoluteOffset + 2 + index * 12;
    const tag = options.view.getUint16(entryOffset, options.littleEndian);
    output.set(tag, {
      entryOffset,
      value: exifAscii(
        options.bytes,
        options.view,
        options.tiffStart,
        options.littleEndian,
        entryOffset,
      ),
    });
  }
  return output;
}

function parseExifDate(value: string | null, offset: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  if (match === null) return null;
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    return null;
  }
  const normalizedOffset = offset !== null && /^[+-]\d{2}:\d{2}$/u.test(offset) ? offset : null;
  const date =
    normalizedOffset === null
      ? new Date(year, month - 1, day, hour, minute, second)
      : new Date(
          `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
            .toString()
            .padStart(2, "0")}T${hour.toString().padStart(2, "0")}:${minute
            .toString()
            .padStart(2, "0")}:${second.toString().padStart(2, "0")}${normalizedOffset}`,
        );
  if (Number.isNaN(date.getTime())) return null;
  const localMatches =
    normalizedOffset !== null ||
    (date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day &&
      date.getHours() === hour &&
      date.getMinutes() === minute &&
      date.getSeconds() === second);
  return localMatches ? date.toISOString() : null;
}

function jpegCapturedAt(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let markerOffset = 2;
  while (markerOffset + 4 <= bytes.byteLength) {
    if (bytes[markerOffset] !== 0xff) return null;
    const marker = bytes[markerOffset + 1];
    if (marker === undefined || marker === 0xda || marker === 0xd9) return null;
    const segmentLength = view.getUint16(markerOffset + 2, false);
    if (segmentLength < 2 || markerOffset + 2 + segmentLength > bytes.byteLength) return null;
    const payloadStart = markerOffset + 4;
    if (marker === 0xe1 && isAsciiAt(bytes, payloadStart, "Exif\0\0")) {
      const tiffStart = payloadStart + 6;
      if (tiffStart + 8 > bytes.byteLength) return null;
      const byteOrder = String.fromCharCode(bytes[tiffStart] ?? 0, bytes[tiffStart + 1] ?? 0);
      if (byteOrder !== "II" && byteOrder !== "MM") return null;
      const littleEndian = byteOrder === "II";
      if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;
      const ifd0 = exifEntries({
        bytes,
        view,
        tiffStart,
        littleEndian,
        ifdOffset: view.getUint32(tiffStart + 4, littleEndian),
      });
      const exifPointer = ifd0.get(0x8769);
      const exifOffset =
        exifPointer === undefined
          ? null
          : view.getUint32(exifPointer.entryOffset + 8, littleEndian);
      const exif =
        exifOffset === null
          ? new Map<number, { readonly entryOffset: number; readonly value: string | null }>()
          : exifEntries({ bytes, view, tiffStart, littleEndian, ifdOffset: exifOffset });
      return (
        parseExifDate(exif.get(0x9003)?.value ?? null, exif.get(0x9011)?.value ?? null) ??
        parseExifDate(exif.get(0x9004)?.value ?? null, exif.get(0x9012)?.value ?? null) ??
        parseExifDate(ifd0.get(0x0132)?.value ?? null, exif.get(0x9010)?.value ?? null)
      );
    }
    markerOffset += 2 + segmentLength;
  }
  return null;
}

export function inspectPhoto(bytes: Uint8Array): DetectedPhoto {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return {
      format: "jpeg",
      contentType: "image/jpeg",
      animated: false,
      capturedAt: jpegCapturedAt(bytes),
    };
  }
  if (
    bytes[0] === 0x89 &&
    isAsciiAt(bytes, 1, "PNG") &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return {
      format: "png",
      contentType: "image/png",
      animated: pngAnimated(bytes),
      capturedAt: null,
    };
  }
  if (isAsciiAt(bytes, 0, "RIFF") && isAsciiAt(bytes, 8, "WEBP")) {
    return {
      format: "webp",
      contentType: "image/webp",
      animated: webpAnimated(bytes),
      capturedAt: null,
    };
  }
  throw new Error("只支持 JPEG、PNG 或 WebP 静态照片");
}

export function validatePhotoDeclaration(file: Pick<File, "name" | "type">, photo: DetectedPhoto) {
  const extension = /\.([^.]+)$/u.exec(file.name)?.[1]?.toLowerCase() ?? "";
  const acceptedExtensions: Record<DetectedPhoto["format"], readonly string[]> = {
    jpeg: ["jpg", "jpeg"],
    png: ["png"],
    webp: ["webp"],
  };
  if (file.type !== photo.contentType || !acceptedExtensions[photo.format].includes(extension)) {
    throw new Error("文件扩展名、声明类型与实际格式不一致");
  }
}
