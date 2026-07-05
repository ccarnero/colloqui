import "./instrumentation";
import "reflect-metadata";
import {
  RequestMethod,
  ValidationPipe,
  VERSION_NEUTRAL,
  VersioningType,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  createPinoLogger,
  getActiveTraceId,
  PinoLoggerService,
  registerHttpMetricsHooks,
  shutdownTelemetry,
  trace,
} from "@yoizen/observability";
import type { GatewayAuditEvent } from "@yoizen/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JetStreamClient } from "nats";
import { AppModule } from "./app.module";
import { gatewayConfig } from "./config";
import {
  configureDynamicRouteHook,
  PLATFORM_PREFIXES,
} from "./hooks/proxy.hook";
import { JwtService } from "./modules/auth/jwt.service";
import { DynamicRouteCacheService } from "./modules/dynamic-routes/dynamic-route-cache.service";
import { RateLimitService } from "./modules/rate-limit/rate-limit.service";
import { configureOpenApi } from "./openapi.config";
import { JETSTREAM } from "./providers/nats.provider";
import type { IYoizenRequest } from "./types/yoizen-request";
import { publishGatewayAuditEvent } from "./utils/gateway-audit-publish.util";

const REQUEST_ID_HEADER = "x-request-id";
const TRACER_NAME = "api-gateway";
const HEALTH_PATHS = new Set(["/health", "/readyz"]);
const accessLogLogger = createPinoLogger("access-log");
const gatewayAuditPublishLogger = new PinoLoggerService("api-gateway");

/** Unversioned `/api/...` paths that are NOT deprecated aliases. */
const VERSIONING_EXEMPT_PREFIXES = ["/api/docs"];
const VERSIONED_API_PREFIX = "/api/v1/";
const UNVERSIONED_API_PREFIX = "/api/";

function isHealthPath(path: string): boolean {
  return HEALTH_PATHS.has(path.split("?")[0]);
}

/**
 * True for legacy `/api/...` requests that should be flagged as deprecated
 * (i.e. everything under `/api/` except the `/api/v1/...` routes themselves
 * and the Swagger docs paths, which were never versioned in the first place).
 */
function isDeprecatedUnversionedApiPath(path: string): boolean {
  if (!path.startsWith(UNVERSIONED_API_PREFIX)) {
    return false;
  }
  if (path.startsWith(VERSIONED_API_PREFIX)) {
    return false;
  }
  return !VERSIONING_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Same path with `v1/` inserted right after the `/api/` prefix. */
function toSuccessorVersionPath(path: string): string {
  return `${VERSIONED_API_PREFIX}${path.slice(UNVERSIONED_API_PREFIX.length)}`;
}

function configureGlobalMiddleware(app: NestFastifyApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );

  app.enableCors({
    origin: gatewayConfig.corsOrigin,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-yoizen-tenant",
      "x-request-id",
    ],
    credentials: true,
  });

  app.setGlobalPrefix("api", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "readyz", method: RequestMethod.GET },
    ],
  });

  // Every route is exposed both unversioned (`/api/...`, deprecated) and as
  // `/api/v1/...` without requiring per-controller `@Version()` decorators.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: ["1", VERSION_NEUTRAL],
  });

  const fastify = app.getHttpAdapter().getInstance();
  registerHttpMetricsHooks(fastify, TRACER_NAME);

  fastify.addHook(
    "onRequest",
    async (req: FastifyRequest, reply: FastifyReply) => {
      (req as IYoizenRequest).__startTime = performance.now();
      reply.header(REQUEST_ID_HEADER, req.id);

      if (isHealthPath(req.url)) {
        return;
      }

      accessLogLogger.info({
        msg: "request started",
        requestId: req.id,
        method: req.method,
        path: req.url.split("?")[0],
      });
    }
  );

  fastify.addHook(
    "onSend",
    async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      const path = req.url.split("?")[0];
      if (isDeprecatedUnversionedApiPath(path)) {
        reply.header("Deprecation", "true");
        reply.header(
          "Link",
          `<${toSuccessorVersionPath(path)}>; rel="successor-version"`
        );
      }
      return payload;
    }
  );

  fastify.addHook(
    "onResponse",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (isHealthPath(req.url)) {
        return;
      }

      const yReq = req as IYoizenRequest;
      const startTime = yReq.__startTime;
      if (startTime === undefined) {
        return;
      }

      const durationMs =
        Math.round((performance.now() - startTime) * 100) / 100;
      const path = req.url.split("?")[0];
      const tenantId =
        yReq.__tenantId ??
        ((yReq as unknown as Record<string, unknown>).tenantId as
          | string
          | undefined);

      accessLogLogger.info({
        msg: "request completed",
        requestId: req.id,
        method: req.method,
        path,
        status: reply.statusCode,
        durationMs,
        ...(tenantId ? { tenantId } : {}),
      });
    }
  );
}

function configureGatewayAuditHook(
  fastify: FastifyInstance,
  js: JetStreamClient
): void {
  fastify.addHook(
    "onResponse",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const yReq = req as IYoizenRequest;
      const startTime = yReq.__startTime;
      if (startTime === undefined) {
        return;
      }

      const isPlatform = PLATFORM_PREFIXES.some((p) =>
        req.url.split("?")[0].startsWith(p)
      );
      if (isPlatform) {
        return;
      }

      const tenantId: string | null = yReq.__tenantId ?? null;
      if (!tenantId && !yReq.__upstream) {
        return;
      }

      const durationMs =
        Math.round((performance.now() - startTime) * 100) / 100;

      const event: GatewayAuditEvent = {
        requestId: req.id,
        traceId: getActiveTraceId() ?? "",
        timestamp: new Date().toISOString(),
        tenantId,
        method: req.method,
        path: req.url.split("?")[0],
        statusCode: reply.statusCode,
        durationMs,
        clientIp: req.ip,
        userAgent: (req.headers["user-agent"] as string) ?? "",
        jwtSubject: yReq.__jwtSubject ?? null,
        routeType: "dynamic",
        upstream: yReq.__upstream,
        rateLimitApplied: yReq.__rateLimitApplied ?? false,
        rateLimitRemaining: yReq.__rateLimitRemaining,
      };

      publishGatewayAuditEvent({
        js,
        event,
        tenantId,
        onError: (err: unknown) => {
          gatewayAuditPublishLogger.error(
            "Failed to publish gateway audit event",
            err instanceof Error ? err.stack : String(err)
          );
        },
      });
    }
  );
}

async function startServer(app: NestFastifyApplication): Promise<void> {
  await app.listen(gatewayConfig.port, "0.0.0.0");
}

async function bootstrap(): Promise<void> {
  const pinoLogger = new PinoLoggerService("api-gateway");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      genReqId: (req: { headers: Record<string, unknown> }) =>
        (req.headers[REQUEST_ID_HEADER] as string | undefined) ??
        crypto.randomUUID(),
    }),
    {
      logger: pinoLogger,
      rawBody: true,
    }
  );

  configureGlobalMiddleware(app);
  configureOpenApi(app);

  const routeCache = app.get(DynamicRouteCacheService);
  const jwtService = app.get(JwtService);
  const rateLimitService = app.get(RateLimitService);
  const js = app.get<JetStreamClient>(JETSTREAM);
  const logger = new PinoLoggerService("DynamicRouteHook");
  const tracer = trace.getTracer(TRACER_NAME);

  const fastify = app.getHttpAdapter().getInstance();

  configureDynamicRouteHook(fastify, {
    routeCache,
    jwtService,
    rateLimitService,
    tracer,
    logger,
  });

  configureGatewayAuditHook(fastify, js);

  await startServer(app);
}

bootstrap().catch((err) => {
  const logger = new PinoLoggerService("api-gateway");
  logger.error(
    "Bootstrap failed",
    err instanceof Error ? err.stack : String(err)
  );
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await shutdownTelemetry();
  process.exit(0);
});
