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
const eventBridgeCertificateHostSuffix = "-eventbridge.oss-accelerate.aliyuncs.com";
const lineFeed = Buffer.from("\n", "utf8");

export type EventBridgeHeaders = Readonly<Record<string, string | string[] | undefined>>;
export type EventBridgeVerificationStage =
  | "body"
  | "hash_method"
  | "signature_version"
  | "timestamp"
  | "token"
  | "certificate_url"
  | "certificate_url_parse"
  | "certificate_url_scheme"
  | "certificate_url_hostname"
  | "certificate_url_port"
  | "certificate_url_credentials"
  | "signature"
  | "certificate_fetch"
  | "rsa_signature";
export type EventBridgeVerificationContext = Readonly<Record<string, string | number | boolean>>;
type CertificateLoader = (url: URL) => Promise<string>;

export class EventBridgeVerificationError extends AppError {
  readonly stage: EventBridgeVerificationStage;
  readonly context?: EventBridgeVerificationContext;

  constructor(stage: EventBridgeVerificationStage, context?: EventBridgeVerificationContext) {
    super({
      code: "FACE_EVENT_SIGNATURE_INVALID",
      message: "事件签名无效",
      statusCode: 403,
    });
    this.name = "EventBridgeVerificationError";
    this.stage = stage;
    this.context = context;
  }
}

function invalidSignature(
  stage: EventBridgeVerificationStage,
  context?: EventBridgeVerificationContext,
): EventBridgeVerificationError {
  return new EventBridgeVerificationError(stage, context);
}

function oneHeader(
  headers: EventBridgeHeaders,
  name: string,
  stage: EventBridgeVerificationStage = "signature",
): string {
  const value = headers[name];
  if (typeof value !== "string" || value === "") {
    throw invalidSignature(stage);
  }
  return value;
}

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isOfficialEventBridgeCertificateHost(hostname: string): boolean {
  if (!hostname.endsWith(eventBridgeCertificateHostSuffix)) return false;
  const regionId = hostname.slice(0, -eventBridgeCertificateHostSuffix.length);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(regionId);
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
  return Buffer.concat([Buffer.from(`${lines.join("\n")}\n`, "utf8"), body]);
}

export function eventBridgeReferenceStringToSign(
  targetUrl: string,
  headers: EventBridgeHeaders,
  body: Buffer,
): Buffer {
  return Buffer.concat([eventBridgeStringToSign(targetUrl, headers, body), lineFeed]);
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
    if (!response.ok) throw invalidSignature("certificate_fetch");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maximumCertificateBytes) throw invalidSignature("certificate_fetch");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumCertificateBytes) {
      throw invalidSignature("certificate_fetch");
    }
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
    if (body.byteLength === 0 || body.byteLength > maximumBodyBytes) {
      throw invalidSignature("body");
    }
    if (oneHeader(headers, "x-eventbridge-hash-method", "hash_method") !== "SHA256") {
      throw invalidSignature("hash_method");
    }
    if (oneHeader(headers, "x-eventbridge-signature-version", "signature_version") !== "1.0") {
      throw invalidSignature("signature_version");
    }
    const timestamp = Number(oneHeader(headers, "x-eventbridge-signature-timestamp", "timestamp"));
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) {
      throw invalidSignature("timestamp");
    }
    const expectedToken = this.#config.EVENTBRIDGE_SIGNATURE_TOKEN;
    const suppliedToken = headers["x-eventbridge-signature-token"];
    if (
      expectedToken !== undefined &&
      (typeof suppliedToken !== "string" || !equalSecret(suppliedToken, expectedToken))
    ) {
      throw invalidSignature("token");
    }

    const certificateUrl = this.#certificateUrl(
      oneHeader(headers, "x-eventbridge-signature-url", "certificate_url"),
    );
    const signature = oneHeader(headers, "x-eventbridge-signature-v2", "signature");
    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(signature, "base64");
    } catch {
      throw invalidSignature("signature");
    }
    if (signatureBytes.byteLength === 0) throw invalidSignature("signature");
    const certificate = await this.#certificate(certificateUrl);
    let valid: boolean;
    try {
      valid = verify(
        "RSA-SHA256",
        eventBridgeStringToSign(this.#targetUrl, headers, body),
        certificate,
        signatureBytes,
      );
      if (!valid) {
        valid = verify(
          "RSA-SHA256",
          eventBridgeReferenceStringToSign(this.#targetUrl, headers, body),
          certificate,
          signatureBytes,
        );
      }
    } catch {
      throw invalidSignature("rsa_signature");
    }
    if (!valid) {
      throw invalidSignature("rsa_signature", {
        configuredTargetUrl: this.#targetUrl,
        triedDocumentedCanonicalForm: true,
        triedReferenceCanonicalForm: true,
      });
    }
  }

  #certificateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw invalidSignature("certificate_url_parse");
    }
    if (url.protocol !== "https:") {
      throw invalidSignature("certificate_url_scheme", {
        actualCertificateScheme: url.protocol,
      });
    }
    if (!isOfficialEventBridgeCertificateHost(url.hostname)) {
      throw invalidSignature("certificate_url_hostname", {
        allowedCertificateHostSuffix: eventBridgeCertificateHostSuffix,
        actualCertificateHost: url.hostname,
      });
    }
    if (url.port !== "") {
      throw invalidSignature("certificate_url_port", {
        actualCertificatePort: url.port,
      });
    }
    if (url.username !== "" || url.password !== "") {
      throw invalidSignature("certificate_url_credentials", {
        hasCertificateUrlCredentials: true,
      });
    }
    return url;
  }

  async #certificate(url: URL): Promise<string> {
    const cached = this.#cache.get(url.href);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.pem;
    let pem: string;
    try {
      pem = await this.#loadCertificate(url);
    } catch (error) {
      if (error instanceof EventBridgeVerificationError) throw error;
      throw invalidSignature("certificate_fetch");
    }
    this.#cache.set(url.href, { pem, expiresAt: Date.now() + 5 * 60_000 });
    return pem;
  }
}
