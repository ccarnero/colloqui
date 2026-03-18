import './instrumentation';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { headers as natsHeaders } from 'nats';
import type { JetStreamClient } from 'nats';
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { AppModule } from './app.module';
import { DynamicRouteCacheService } from './modules/dynamic-routes/dynamic-route-cache.service';
import { JwtService } from './modules/auth/jwt.service';
import { RateLimitService } from './modules/rate-limit/rate-limit.service';
import { JETSTREAM } from './providers/nats.provider';
import {
  TENANT_HEADER,
  GATEWAY_AUDIT_SUBJECT,
} from '@yoizen/shared';
import type { GatewayAuditEvent } from '@yoizen/shared';
import {
  PinoLoggerService,
  registerHttpMetricsHooks,
  shutdownTelemetry,
  getActiveTraceId,
  tracedFetch,
} from '@yoizen/observability';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const PLATFORM_PREFIXES = [
  '/events',
  '/audit',
  '/tenants',
  '/schedulers',
  '/registry',
  '/workflows',
  '/proxy',
  '/health',
  '/auth',
];

const HOST_PATTERN = /^[^.]+\.([^.]+)\.yplatform\.com$/;
const PROXY_TIMEOUT_MS = 30_000;
const REQUEST_ID_HEADER = 'x-request-id';
const TRACER_NAME = 'api-gateway';
const encoder = new TextEncoder();

function resolveTenantFromRequest(req: FastifyRequest): string | null {
  const header = req.headers[TENANT_HEADER] as string | undefined;
  if (header) return header;

  const host = req.headers.host ?? '';
  const match = HOST_PATTERN.exec(host);
  if (match) return match[1];

  return null;
}

async function bootstrap(): Promise<void> {
  const pinoLogger = new PinoLoggerService('api-gateway');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: pinoLogger },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const routeCache = app.get(DynamicRouteCacheService);
  const jwtService = app.get(JwtService);
  const rateLimitService = app.get(RateLimitService);
  const js = app.get<JetStreamClient>(JETSTREAM);
  const logger = new Logger('DynamicRouteHook');
  const tracer = trace.getTracer(TRACER_NAME);

  const fastify = app.getHttpAdapter().getInstance();

  registerHttpMetricsHooks(fastify, TRACER_NAME);

  fastify.addHook(
    'onRequest',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const incomingId = req.headers[REQUEST_ID_HEADER] as string | undefined;
      const requestId = incomingId ?? crypto.randomUUID();
      (req as any).__requestId = requestId;
      (req as any).__startTime = performance.now();
      reply.header(REQUEST_ID_HEADER, requestId);
    },
  );

  fastify.addHook(
    'onRequest',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = resolveTenantFromRequest(req);
      (req as any).__tenantId = tenantId;
      (req as any).__rateLimitApplied = false;

      if (tenantId) {
        const rl = await rateLimitService.consume(tenantId);
        reply.header('X-RateLimit-Limit', rl.limit);
        reply.header('X-RateLimit-Remaining', rl.remaining);
        reply.header('X-RateLimit-Reset', rl.resetSeconds);
        (req as any).__rateLimitApplied = true;
        (req as any).__rateLimitRemaining = rl.remaining;

        if (!rl.allowed) {
          reply
            .status(429)
            .header('Retry-After', rl.resetSeconds)
            .send({ statusCode: 429, message: 'Too Many Requests' });
          return;
        }
      }

      const path = req.url.split('?')[0];

      for (let i = 0; i < PLATFORM_PREFIXES.length; i++) {
        if (path.startsWith(PLATFORM_PREFIXES[i])) return;
      }

      if (!tenantId) return;

      const matched = routeCache.match(tenantId, req.method, path);
      if (!matched) return;

      const span = tracer.startSpan('gateway.dynamic_route', {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': req.method,
          'http.url': req.url,
          'tenant.id': tenantId,
          'route.knative_name': matched.knativeName,
          'route.is_public': matched.isPublic,
        },
      });
      (req as any).__dynamicRouteSpan = span;

      const spanCtx = trace.setSpan(context.active(), span);

      await context.with(spanCtx, async () => {
        if (!matched.isPublic) {
          const authSpan = tracer.startSpan('gateway.jwt_verify', { kind: SpanKind.INTERNAL });
          try {
            const authHeader = (req.headers.authorization ??
              req.headers.Authorization) as string | undefined;
            if (!authHeader) {
              authSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'missing auth header' });
              reply.status(401).send({ statusCode: 401, message: 'Missing Authorization header' });
              span.setStatus({ code: SpanStatusCode.ERROR, message: '401' });
              span.end();
              return;
            }
            const parts = authHeader.split(' ');
            if (parts.length !== 2 || parts[0] !== 'Bearer') {
              authSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'invalid format' });
              reply.status(401).send({ statusCode: 401, message: 'Invalid Authorization header format' });
              span.setStatus({ code: SpanStatusCode.ERROR, message: '401' });
              span.end();
              return;
            }
            const payload = await jwtService.verify(parts[1]);
            const scope = payload.scope as string;
            if (scope !== 'platform' && scope !== `tenant:${tenantId}`) {
              authSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'scope mismatch' });
              reply.status(403).send({ statusCode: 403, message: 'Token scope does not match tenant' });
              span.setStatus({ code: SpanStatusCode.ERROR, message: '403' });
              span.end();
              return;
            }
            (req as any).__jwtSubject = payload.sub;
            authSpan.setStatus({ code: SpanStatusCode.OK });
          } catch {
            authSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'invalid token' });
            reply.status(401).send({ statusCode: 401, message: 'Invalid or expired token' });
            span.setStatus({ code: SpanStatusCode.ERROR, message: '401' });
            span.end();
            return;
          } finally {
            authSpan.end();
          }
        }

        const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        const upstreamUrl =
          `http://${matched.knativeName}.${matched.namespace}.svc.cluster.local${matched.upstreamPath}${queryString}`;

        const proxyStart = performance.now();

        const upstreamHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(req.headers)) {
          if (key === 'host' || key === 'connection' || key === 'transfer-encoding') continue;
          if (typeof val === 'string') upstreamHeaders[key] = val;
        }

        const init: RequestInit = {
          method: req.method,
          headers: upstreamHeaders,
          signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        };

        if (
          req.method !== 'GET' &&
          req.method !== 'HEAD' &&
          req.method !== 'DELETE' &&
          req.body !== undefined
        ) {
          init.body = JSON.stringify(req.body);
        }

        try {
          const upstream = await tracedFetch(upstreamUrl, init);

          reply.status(upstream.status);
          upstream.headers.forEach((value, key) => {
            if (key === 'transfer-encoding' || key === 'connection') return;
            reply.header(key, value);
          });

          const body = await upstream.text();
          reply.send(body);

          span.setAttribute('http.status_code', upstream.status);
          span.setStatus({ code: SpanStatusCode.OK });

          (req as any).__upstream = {
            url: upstreamUrl,
            statusCode: upstream.status,
            durationMs: Math.round((performance.now() - proxyStart) * 100) / 100,
          };
        } catch (err) {
          logger.error(`Dynamic route proxy error for ${req.method} ${upstreamUrl}: ${err}`);
          reply.status(502).send({ statusCode: 502, message: 'Bad Gateway' });
          span.setStatus({ code: SpanStatusCode.ERROR, message: '502' });
          (req as any).__upstream = {
            url: upstreamUrl,
            statusCode: 502,
            durationMs: Math.round((performance.now() - proxyStart) * 100) / 100,
          };
        } finally {
          span.end();
        }
      });
    },
  );

  fastify.addHook(
    'onResponse',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const startTime = (req as any).__startTime as number | undefined;
      if (startTime === undefined) return;

      const isPlatform = PLATFORM_PREFIXES.some((p) =>
        req.url.split('?')[0].startsWith(p),
      );
      if (isPlatform) return;

      const tenantId: string | null = (req as any).__tenantId ?? null;
      if (!tenantId && !(req as any).__upstream) return;

      const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

      const event: GatewayAuditEvent = {
        requestId: (req as any).__requestId ?? req.id,
        traceId: getActiveTraceId() ?? '',
        timestamp: new Date().toISOString(),
        tenantId,
        method: req.method,
        path: req.url.split('?')[0],
        statusCode: reply.statusCode,
        durationMs,
        clientIp: req.ip,
        userAgent: (req.headers['user-agent'] as string) ?? '',
        jwtSubject: (req as any).__jwtSubject ?? null,
        routeType: 'dynamic',
        upstream: (req as any).__upstream,
        rateLimitApplied: (req as any).__rateLimitApplied ?? false,
        rateLimitRemaining: (req as any).__rateLimitRemaining,
      };

      const hdrs = natsHeaders();
      if (tenantId) hdrs.set(TENANT_HEADER, tenantId);

      js.publish(GATEWAY_AUDIT_SUBJECT, encoder.encode(JSON.stringify(event)), { headers: hdrs })
        .catch(() => {});
    },
  );

  await app.listen(PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
