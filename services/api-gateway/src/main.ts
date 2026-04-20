import "./instrumentation";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IYoizenRequest } from "./types/yoizen-request";
import type { JetStreamClient } from "nats";
import { AppModule } from "./app.module";
import { gatewayConfig } from "./config";
import { DynamicRouteCacheService } from "./modules/dynamic-routes/dynamic-route-cache.service";
import { JwtService } from "./modules/auth/jwt.service";
import { RateLimitService } from "./modules/rate-limit/rate-limit.service";
import { JETSTREAM } from "./providers/nats.provider";
import type { GatewayAuditEvent } from "@yoizen/shared";
import {
  PinoLoggerService,
  registerHttpMetricsHooks,
  shutdownTelemetry,
  getActiveTraceId,
  trace,
} from "@yoizen/observability";
import {
  configureDynamicRouteHook,
  PLATFORM_PREFIXES,
} from "./hooks/proxy.hook";
import { publishGatewayAuditEvent } from "./utils/gateway-audit-publish.util";

const REQUEST_ID_HEADER = "x-request-id";
const TRACER_NAME = "api-gateway";
const gatewayAuditPublishLogger = new PinoLoggerService("api-gateway");

function configureGlobalMiddleware(app: NestFastifyApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
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
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });

  const fastify = app.getHttpAdapter().getInstance();
  registerHttpMetricsHooks(fastify, TRACER_NAME);

  fastify.addHook(
    "onRequest",
    async (req: FastifyRequest, reply: FastifyReply) => {
      (req as IYoizenRequest).__startTime = performance.now();
      reply.header(REQUEST_ID_HEADER, req.id);
    },
  );
}

function configureGatewayAuditHook(
  fastify: FastifyInstance,
  js: JetStreamClient,
): void {
  fastify.addHook(
    "onResponse",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const yReq = req as IYoizenRequest;
      const startTime = yReq.__startTime;
      if (startTime === undefined) return;

      const isPlatform = PLATFORM_PREFIXES.some((p) =>
        req.url.split("?")[0].startsWith(p),
      );
      if (isPlatform) return;

      const tenantId: string | null = yReq.__tenantId ?? null;
      if (!tenantId && !yReq.__upstream) return;

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
            err instanceof Error ? err.stack : String(err),
          );
        },
      });
    },
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
    },
  );

  configureGlobalMiddleware(app);

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
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await shutdownTelemetry();
  process.exit(0);
});
