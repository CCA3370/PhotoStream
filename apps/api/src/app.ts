import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { apiErrorSchema, healthResponseSchema } from "@photostream/contracts";
import Fastify, { type FastifyInstance, type FastifyServerOptions, LogController } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { argon2PasswordHasher } from "./auth/password.js";
import { AuthService } from "./auth/service.js";
import type { AuthStore, PasswordHasher } from "./auth/types.js";
import type { UserAdminService } from "./auth/user-admin-service.js";
import type { BibService } from "./bib/service.js";
import type { AppConfig } from "./config.js";
import type { EventBridgeVerifier } from "./face/eventbridge-verifier.js";
import type { FaceService } from "./face/service.js";
import { AppError } from "./errors.js";
import { assertRequestOrigin, requestRouteForLog } from "./http/security.js";
import type { LiveEventBroker } from "./media/live-event-broker.js";
import type { OperationsService } from "./media/operations-service.js";
import type { PhotoService } from "./media/service.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBibRoutes } from "./routes/bib.js";
import { registerFaceRoutes } from "./routes/face.js";
import { registerOperationsRoutes } from "./routes/operations.js";
import { registerPhotoRoutes } from "./routes/photos.js";
import { registerUserRoutes } from "./routes/users.js";

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly authStore: AuthStore;
  readonly passwordHasher?: PasswordHasher;
  readonly photoService?: PhotoService;
  readonly broker?: LiveEventBroker;
  readonly userAdminService?: UserAdminService;
  readonly operationsService?: OperationsService;
  readonly bibService?: BibService;
  readonly faceService?: FaceService;
  readonly eventBridgeVerifier?: EventBridgeVerifier;
  readonly logger?: NonNullable<FastifyServerOptions["logger"]>;
}

function loggerOptions(config: AppConfig): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-csrf-token",
        "req.headers.x-eventbridge-signature-v2",
        "req.headers.x-eventbridge-signature-token",
        "res.headers.set-cookie",
        "password",
        "currentPassword",
        "newPassword",
      ],
      censor: "[REDACTED]",
    },
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const serverOptions: FastifyServerOptions = {
    logger: options.logger ?? loggerOptions(options.config),
    requestIdHeader: "x-request-id",
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: "requestId",
    }),
    trustProxy: ["127.0.0.1", "::1"],
  };
  const app: FastifyInstance = Fastify(serverOptions);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "中学部影像直播 API",
        version: "0.1.0",
      },
    },
    transform: jsonSchemaTransform,
  });

  app.addHook("onRequest", async (request) => {
    assertRequestOrigin(request, options.config);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header("x-request-id", request.id);
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: requestRouteForLog(request),
        statusCode: reply.statusCode,
      },
      "request completed",
    );
  });

  app.setErrorHandler((error, request, reply) => {
    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else if (hasZodFastifySchemaValidationErrors(error)) {
      appError = new AppError({
        code: "BAD_REQUEST",
        message: "请求参数无效",
        statusCode: 400,
      });
    } else if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      appError = new AppError({
        code: "AUTH_RATE_LIMITED",
        message: "尝试次数过多，请稍后再试",
        statusCode: 429,
        retryable: true,
      });
    } else if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      (error.statusCode === 400 || error.statusCode === 415)
    ) {
      appError = new AppError({
        code: "BAD_REQUEST",
        message: "请求参数无效",
        statusCode: 400,
      });
    } else {
      request.log.error(
        {
          errorName: error instanceof Error ? error.name : "unknown",
          errorCode:
            typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
        },
        "request failed",
      );
      appError = new AppError({
        code: "INTERNAL_ERROR",
        message: "服务器暂时无法完成请求",
        statusCode: 500,
        retryable: true,
      });
    }

    return reply.status(appError.statusCode).send({
      code: appError.code,
      message: appError.message,
      requestId: request.id,
      retryable: appError.retryable,
    });
  });

  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    "/api/v1/health/live",
    {
      schema: {
        operationId: "liveness",
        tags: ["health"],
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({ status: "ok" as const }),
  );
  typed.get(
    "/api/v1/health/ready",
    {
      schema: {
        operationId: "readiness",
        tags: ["health"],
        response: {
          200: healthResponseSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        await options.authStore.ping();
        return { status: "ok" as const };
      } catch {
        return reply.status(503).send({
          code: "SERVICE_UNAVAILABLE",
          message: "服务尚未就绪",
          requestId: reply.request.id,
          retryable: true,
        });
      }
    },
  );
  typed.get(
    "/api/v1/openapi.json",
    {
      schema: { hide: true },
    },
    async () => app.swagger(),
  );

  const authService = new AuthService(
    options.authStore,
    options.passwordHasher ?? argon2PasswordHasher,
    options.config,
  );
  await registerAuthRoutes(app, { authService, config: options.config });
  if (options.userAdminService !== undefined) {
    await registerUserRoutes(app, {
      authService,
      userAdminService: options.userAdminService,
      config: options.config,
    });
  }
  if (options.photoService !== undefined && options.broker !== undefined) {
    await registerPhotoRoutes(app, {
      authService,
      photoService: options.photoService,
      broker: options.broker,
      config: options.config,
      ...(options.operationsService === undefined
        ? {}
        : { operationsService: options.operationsService }),
      ...(options.bibService === undefined ? {} : { bibService: options.bibService }),
    });
  }
  if (options.photoService !== undefined && options.operationsService !== undefined) {
    await registerOperationsRoutes(app, {
      authService,
      photoService: options.photoService,
      operationsService: options.operationsService,
      config: options.config,
    });
  }
  if (options.bibService !== undefined) {
    await registerBibRoutes(app, {
      authService,
      bibService: options.bibService,
      config: options.config,
    });
  }
  if (options.faceService !== undefined && options.eventBridgeVerifier !== undefined) {
    await registerFaceRoutes(app, {
      authService,
      faceService: options.faceService,
      eventBridgeVerifier: options.eventBridgeVerifier,
      config: options.config,
    });
  }

  return app;
}
