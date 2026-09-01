const productionMediaOrigin = "https://cdn.cloverta.top";

function mediaOrigin(value: string | undefined, nodeEnvironment: string, label: string): string {
  const parsed = new URL(value ?? productionMediaOrigin);
  if (
    parsed.protocol !== "https:" &&
    !(nodeEnvironment === "development" && parsed.protocol === "http:")
  ) {
    throw new Error(`${label} must use HTTPS outside development`);
  }
  return parsed.origin;
}

export function contentSecurityPolicy(options: {
  readonly nonce: string;
  readonly mediaBaseUrl?: string;
  readonly uploadBaseUrl?: string;
  readonly faceReferenceUploadBaseUrl?: string;
  readonly nodeEnvironment: string;
}): string {
  if (!/^[A-Za-z0-9+/_=-]{16,256}$/u.test(options.nonce)) {
    throw new Error("CSP nonce is invalid");
  }
  const origin = mediaOrigin(options.mediaBaseUrl, options.nodeEnvironment, "MEDIA_BASE_URL");
  const uploadOrigin = mediaOrigin(
    options.uploadBaseUrl ?? options.mediaBaseUrl,
    options.nodeEnvironment,
    "PHOTO_UPLOAD_BASE_URL",
  );
  const faceReferenceUploadOrigin = mediaOrigin(
    options.faceReferenceUploadBaseUrl ?? options.uploadBaseUrl ?? options.mediaBaseUrl,
    options.nodeEnvironment,
    "FACE_REFERENCE_UPLOAD_BASE_URL",
  );
  const connectionOrigins = [...new Set([origin, uploadOrigin, faceReferenceUploadOrigin])].join(
    " ",
  );
  const development = options.nodeEnvironment === "development";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${origin}`,
    `connect-src 'self' ${connectionOrigins}${development ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "worker-src 'self' blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ];
  return `${directives.join("; ")};`;
}
