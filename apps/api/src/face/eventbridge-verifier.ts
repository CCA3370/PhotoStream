import { timingSafeEqual, verify } from "node:crypto";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";

const signatureHeaders = [
  "x-eventbridge-signature-timestamp",
  "x-eventbridge-hash-method",
  "x-eventbridge-signature-version",
  "x-eventbridge-signature-url",
] as const;
const maximumBodyBytes = 512 * 1024;
const maximumCertificateBytes = 64 * 1024;

export type EventBridgeHeaders = Readonly<Record<string, string | string[] | undefined>>;
type CertificateLoader = (url: URL) => Promise<string>;

function oneHeader(headers: EventBridgeHeaders, name: string): string {
  const value = headers[name];
  if (typeof value !== "string" || value === "") {
    throw invalidSignature();
  }
  return value;
}

function invalidSignature(): AppError {
  return new AppError({
    code: "FACE_EVENT_SIGNATURE_INVALID",
    message: "事件签名无效",
    statusCode: 403,
  });
}

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function eventBridgeStringToSign(
  targetUrl: string,
  headers: EventBridgeHeaders,
  body: Buffer,
): Buffer {
  const lines = [targetUrl];
  for (const name of signatureHeaders) lines.push(`${name}: ${oneHeader(headers, name)}`);
  const token = headers["x-eventbridge-signature-token"];
  if (typeof token === "string" && token !== "") {
    lines.push(`x-eventbridge-signature-token: ${token}`);
  }
  return Buffer.concat([
    Buffer.from(`${lines.join("\n")}\n`, "utf8"),
    body,
    Buffer.from("\n", "utf8"),
  ]);
}

async function loadCertificate(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/x-pem-file,text/plain" },
    });
    if (!response.ok) throw invalidSignature();
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maximumCertificateBytes) throw invalidSignature();
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumCertificateBytes) throw invalidSignature();
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export class EventBridgeVerifier {
  readonly #config: AppConfig;
  readonly #targetUrl: string;
  readonly #loadCertificate: CertificateLoader;
  readonly #cache = new Map<string, { pem: string; expiresAt: number }>();

  constructor(
    config: AppConfig,
    options: { targetUrl?: string; certificateLoader?: CertificateLoader } = {},
  ) {
    this.#config = config;
    this.#targetUrl =
      options.targetUrl ??
      new URL("/api/v1/integrations/aliyun/eventbridge", config.APP_ORIGIN).toString();
    this.#loadCertificate = options.certificateLoader ?? loadCertificate;
  }

  async verify(headers: EventBridgeHeaders, body: Buffer): Promise<void> {
    if (body.byteLength === 0 || body.byteLength > maximumBodyBytes) throw invalidSignature();
    if (oneHeader(headers, "x-eventbridge-hash-method") !== "SHA256") throw invalidSignature();
    if (oneHeader(headers, "x-eventbridge-signature-version") !== "1.0") {
      throw invalidSignature();
    }
    const timestamp = Number(oneHeader(headers, "x-eventbridge-signature-timestamp"));
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) {
      throw invalidSignature();
    }
    const expectedToken = this.#config.EVENTBRIDGE_SIGNATURE_TOKEN;
    const suppliedToken = headers["x-eventbridge-signature-token"];
    if (
      expectedToken !== undefined &&
      (typeof suppliedToken !== "string" || !equalSecret(suppliedToken, expectedToken))
    ) {
      throw invalidSignature();
    }

    const certificateUrl = this.#certificateUrl(oneHeader(headers, "x-eventbridge-signature-url"));
    const signature = oneHeader(headers, "x-eventbridge-signature-v2");
    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(signature, "base64");
    } catch {
      throw invalidSignature();
    }
    if (signatureBytes.byteLength === 0) throw invalidSignature();
    const certificate = await this.#certificate(certificateUrl);
    const valid = verify(
      "RSA-SHA256",
      eventBridgeStringToSign(this.#targetUrl, headers, body),
      certificate,
      signatureBytes,
    );
    if (!valid) throw invalidSignature();
  }

  #certificateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw invalidSignature();
    }
    const expectedHost = `${this.#config.ALIYUN_IMM_REGION}-eventbridge.oss-accelerate.aliyuncs.com`;
    if (
      url.protocol !== "https:" ||
      url.hostname !== expectedHost ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/x509_public_certificate_[A-Za-z0-9._-]+\.pem$/u.test(url.pathname)
    ) {
      throw invalidSignature();
    }
    return url;
  }

  async #certificate(url: URL): Promise<string> {
    const cached = this.#cache.get(url.href);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.pem;
    let pem: string;
    try {
      pem = await this.#loadCertificate(url);
    } catch {
      throw invalidSignature();
    }
    this.#cache.set(url.href, { pem, expiresAt: Date.now() + 5 * 60_000 });
    return pem;
  }
}
