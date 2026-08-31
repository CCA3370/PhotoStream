import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { contentSecurityPolicy } from "@/lib/content-security-policy";

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID(), "utf8").toString("base64");
  const policy = contentSecurityPolicy({
    nonce,
    ...(process.env.MEDIA_BASE_URL === undefined
      ? {}
      : { mediaBaseUrl: process.env.MEDIA_BASE_URL }),
    ...(process.env.PHOTO_UPLOAD_BASE_URL === undefined
      ? {}
      : { uploadBaseUrl: process.env.PHOTO_UPLOAD_BASE_URL }),
    nodeEnvironment: process.env.NODE_ENV ?? "production",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", policy);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|assets/|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
