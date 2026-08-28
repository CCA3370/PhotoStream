import { describe, expect, it } from "vitest";

import { inspectPhoto, validatePhotoDeclaration } from "./photo-inspection";

function jpegWithExif(): Uint8Array {
  const date = new TextEncoder().encode("2026:08:27 13:45:09\0");
  const offset = new TextEncoder().encode("+08:00\0");
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 24 + 4 + date.length + offset.length);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  view.setUint16(26, 2, true);
  const dateEntry = 28;
  view.setUint16(dateEntry, 0x9003, true);
  view.setUint16(dateEntry + 2, 2, true);
  view.setUint32(dateEntry + 4, date.length, true);
  view.setUint32(dateEntry + 8, 56, true);
  const offsetEntry = 40;
  view.setUint16(offsetEntry, 0x9011, true);
  view.setUint16(offsetEntry + 2, 2, true);
  view.setUint32(offsetEntry + 4, offset.length, true);
  view.setUint32(offsetEntry + 8, 56 + date.length, true);
  view.setUint32(52, 0, true);
  tiff.set(date, 56);
  tiff.set(offset, 56 + date.length);

  const payload = new Uint8Array(6 + tiff.length);
  payload.set(new TextEncoder().encode("Exif\0\0"));
  payload.set(tiff, 6);
  const jpeg = new Uint8Array(2 + 2 + 2 + payload.length + 2);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1]);
  new DataView(jpeg.buffer).setUint16(4, payload.length + 2, false);
  jpeg.set(payload, 6);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  return jpeg;
}

describe("photo inspection", () => {
  it("extracts only the EXIF capture time with its explicit offset", () => {
    expect(inspectPhoto(jpegWithExif())).toEqual({
      format: "jpeg",
      contentType: "image/jpeg",
      animated: false,
      capturedAt: "2026-08-27T05:45:09.000Z",
    });
  });

  it("rejects animated PNG and declaration mismatches", () => {
    const png = new Uint8Array(20);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set(new TextEncoder().encode("acTL"), 12);
    expect(inspectPhoto(png).animated).toBe(true);
    expect(() =>
      validatePhotoDeclaration({ name: "fixture.jpg", type: "image/png" }, inspectPhoto(png)),
    ).toThrow("文件扩展名、声明类型与实际格式不一致");
  });

  it("detects static and animated WebP magic without trusting a declaration", () => {
    const staticWebp = new TextEncoder().encode(
      "RIFF\u0004\u0000\u0000\u0000WEBPVP8 \u0000\u0000\u0000\u0000",
    );
    const animatedWebp = new TextEncoder().encode(
      "RIFF\u000c\u0000\u0000\u0000WEBPANIM\u0000\u0000\u0000\u0000",
    );
    expect(inspectPhoto(staticWebp)).toMatchObject({
      format: "webp",
      contentType: "image/webp",
      animated: false,
    });
    expect(inspectPhoto(animatedWebp).animated).toBe(true);
    expect(() => inspectPhoto(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toThrow(
      "只支持 JPEG、PNG 或 WebP 静态照片",
    );
  });
});
