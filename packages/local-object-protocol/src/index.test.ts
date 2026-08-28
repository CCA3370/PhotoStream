import { describe, expect, it } from "vitest";

import {
  signLocalMultipartCompleteUrl,
  signLocalMultipartPartUrl,
  signLocalObjectUrl,
  verifyLocalMultipartCompleteRequest,
  verifyLocalMultipartPartRequest,
  verifyLocalObjectRequest,
} from "./index.js";

const secret = "local-object-protocol-test-secret-123456";

describe("local object protocol", () => {
  it("round-trips an exact signed PUT contract", () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const url = new URL(
      signLocalObjectUrl({
        baseUrl: "http://127.0.0.1:3002",
        key: "media/albums/a/photos/m/480.webp",
        method: "PUT",
        secret,
        expiresAt,
        contentType: "image/webp",
        contentLength: 123,
      }),
    );
    expect(
      verifyLocalObjectRequest({
        url,
        method: "PUT",
        secret,
        now: new Date("2029-12-31T23:59:00.000Z"),
      }),
    ).toEqual({
      key: "media/albums/a/photos/m/480.webp",
      contentType: "image/webp",
      contentLength: 123,
      expiresAt,
    });
  });

  it("rejects method, path, signature and expiry tampering", () => {
    const signed = new URL(
      signLocalObjectUrl({
        baseUrl: "http://localhost:3002",
        key: "media/a.jpg",
        method: "GET",
        secret,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      }),
    );
    expect(() =>
      verifyLocalObjectRequest({
        url: signed,
        method: "HEAD",
        secret,
        now: new Date("2029-01-01"),
      }),
    ).toThrow("Invalid signature");

    signed.pathname = "/objects/media/b.jpg";
    expect(() =>
      verifyLocalObjectRequest({ url: signed, method: "GET", secret, now: new Date("2029-01-01") }),
    ).toThrow("Invalid signature");

    expect(() =>
      verifyLocalObjectRequest({
        url: new URL(
          signLocalObjectUrl({
            baseUrl: "http://localhost:3002",
            key: "media/a.jpg",
            method: "GET",
            secret,
            expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          }),
        ),
        method: "GET",
        secret,
        now: new Date("2029-01-01"),
      }),
    ).toThrow("Expired signature");
  });

  it("binds multipart part and completion manifests into signatures", () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const uploadId = "019d43f4-7d20-7000-8000-000000000001";
    const part = new URL(
      signLocalMultipartPartUrl({
        baseUrl: "http://127.0.0.1:3002",
        uploadId,
        partNumber: 2,
        secret,
        expiresAt,
        contentType: "image/jpeg",
        contentLength: 8,
      }),
    );
    expect(
      verifyLocalMultipartPartRequest({
        url: part,
        method: "PUT",
        secret,
        now: new Date("2029-01-01"),
      }),
    ).toMatchObject({ uploadId, partNumber: 2, contentLength: 8 });

    const complete = new URL(
      signLocalMultipartCompleteUrl({
        baseUrl: "http://127.0.0.1:3002",
        uploadId,
        objectKey: "media/albums/a/photos/m/original.jpg",
        contentType: "image/jpeg",
        manifest: [{ partNumber: 1, etag: "a".repeat(64) }],
        secret,
        expiresAt,
      }),
    );
    expect(
      verifyLocalMultipartCompleteRequest({
        url: complete,
        method: "POST",
        secret,
        now: new Date("2029-01-01"),
      }),
    ).toMatchObject({
      uploadId,
      objectKey: "media/albums/a/photos/m/original.jpg",
      manifest: [{ partNumber: 1, etag: "a".repeat(64) }],
    });
    complete.searchParams.set("objectKey", "media/albums/a/photos/other.jpg");
    expect(() =>
      verifyLocalMultipartCompleteRequest({
        url: complete,
        method: "POST",
        secret,
        now: new Date("2029-01-01"),
      }),
    ).toThrow("Invalid signature");
  });
});
