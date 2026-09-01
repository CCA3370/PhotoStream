import type { FastifyRequest } from "fastify";

import type { AppConfig } from "../config.js";
import { trustedHosts } from "../config.js";
import { AppError } from "../errors.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const signedIntegrationPath = "/api/v1/integrations/aliyun/eventbridge";

export function assertRequestOrigin(request: FastifyRequest, config: AppConfig): void {
  const host = request.headers.host;
  if (host === undefined || !trustedHosts(config).has(host)) {
    throw new AppError({
      code: "AUTH_ORIGIN_INVALID",
      message: "请求来源无效",
      statusCode: 403,
    });
  }

  const path = request.url.split("?", 1)[0];
  if (!safeMethods.has(request.method) && !(request.method === "POST" && path === signedIntegrationPath)) {
    const origin = request.headers.origin;
    if (origin !== config.APP_ORIGIN) {
      throw new AppError({
        code: "AUTH_ORIGIN_INVALID",
        message: "请求来源无效",
        statusCode: 403,
      });
    }
  }
}

export function requestRouteForLog(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "unknown";
}
