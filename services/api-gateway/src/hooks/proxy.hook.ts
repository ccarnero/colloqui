import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IYoizenRequest } from "../types/yoizen-request";
import type { DynamicRouteCacheService } from "../modules/dynamic-routes/dynamic-route-cache.service";
import type { JwtService } from "../modules/auth/jwt.service";
import type { RateLimitService } from "../modules/rate-limit/rate-limit.service";
import { PROXY_TIMEOUT_MS } from "../constants";
import { resolveTenantIdFromHttpRequest } from "../utils/tenant-resolution.util";
import { copyForwardableHeaders } from "../utils/copy-forwardable-headers";
import { pipeUpstreamResponseToReply } from "../utils/pipe-upstream-to-reply.util";
import {
  tracedFetch,
  trace,
  context,
  SpanKind,
  SpanStatusCode,
} from "@yoizen/observability";

interface ILoggerLike {
  error(message: string): void;
}

export const PLATFORM_PREFIXES = [
  "/api/events",
  "/api/audit",
  "/api/tenants",
  "/api/schedulers",
  "/api/registry",
  "/api/adapters",
  "/api/channels",
  "/api/webhooks",
  "/api/workflows",
  "/api/proxy",
  "/api/auth",
  "/api/dashboard",
  "/api/admin",
  "/api/runtime",
  "/health",
];

export function resolveTenantFromRequest(req: FastifyRequest): string | null {
  return resolveTenantIdFromHttpRequest(req.headers, req.query);
}

interface IDynamicRouteHookContext {
  routeCache: DynamicRouteCacheService;
  jwtService: JwtService;
  rateLimitService: RateLimitService;
  tracer: ReturnType<typeof trace.getTracer>;
  logger: ILoggerLike;
}

/** True when the path is handled by the API gateway (not dynamic tenant routes). */
export function isPlatformRoutePath(path: string): boolean {
  for (let i = 0; i < PLATFORM_PREFIXES.length; i++) {
    if (path.startsWith(PLATFORM_PREFIXES[i])) return true;
  }
  return false;
}

interface IMatchedRoute {
  knativeName: string;
  namespace: string;
  /** Service port when not 80 (cluster HTTP). */
  port: number;
  upstreamPath: string;
  isPublic: boolean;
}

interface IApplyTenantRateLimitOptions {
  tenantId: string | null;
  rateLimitService: RateLimitService;
  req: IYoizenRequest;
  reply: FastifyReply;
}

/**
 * Applies per-tenant rate limit headers and returns false if the request was
 * rejected (429). When tenantId is null, does nothing and returns true.
 */
async function applyTenantRateLimit(
  opts: IApplyTenantRateLimitOptions,
): Promise<boolean> {
  const { tenantId, rateLimitService, req, reply } = opts;
  if (!tenantId) return true;

  const rl = await rateLimitService.consume(tenantId);
  reply.header("X-RateLimit-Limit", rl.limit);
  reply.header("X-RateLimit-Remaining", rl.remaining);
  reply.header("X-RateLimit-Reset", rl.resetSeconds);
  req.__rateLimitApplied = true;
  req.__rateLimitRemaining = rl.remaining;

  if (!rl.allowed) {
    reply
      .status(429)
      .header("Retry-After", rl.resetSeconds)
      .send({ statusCode: 429, message: "Too Many Requests" });
    return false;
  }
  return true;
}

interface IVerifyBearerForPrivateRouteOptions {
  req: FastifyRequest;
  reply: FastifyReply;
  yReq: IYoizenRequest;
  tenantId: string;
  matched: IMatchedRoute;
  jwtService: JwtService;
  tracer: ReturnType<typeof trace.getTracer>;
  span: ReturnType<ReturnType<typeof trace.getTracer>["startSpan"]>;
}

/**
 * Verifies Bearer JWT for non-public routes. Returns false if the response
 * was already sent (401/403).
 */
export async function verifyBearerForPrivateRoute(
  opts: IVerifyBearerForPrivateRouteOptions,
): Promise<boolean> {
  const { req, reply, yReq, tenantId, matched, jwtService, tracer, span } =
    opts;
  if (matched.isPublic) return true;

  const authSpan = tracer.startSpan("gateway.jwt_verify", {
    kind: SpanKind.INTERNAL,
  });
  try {
    const authHeader = (req.headers.authorization ??
      req.headers.Authorization) as string | undefined;
    if (!authHeader) {
      authSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: "missing auth header",
      });
      reply.status(401).send({
        statusCode: 401,
        message: "Missing Authorization header",
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: "401" });
      span.end();
      return false;
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      authSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: "invalid format",
      });
      reply.status(401).send({
        statusCode: 401,
        message: "Invalid Authorization header format",
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: "401" });
      span.end();
      return false;
    }
    const payload = await jwtService.verify(parts[1]);
    const scope = payload.scope as string;
    if (scope !== "platform" && scope !== `tenant:${tenantId}`) {
      authSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: "scope mismatch",
      });
      reply.status(403).send({
        statusCode: 403,
        message: "Token scope does not match tenant",
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: "403" });
      span.end();
      return false;
    }
    yReq.__jwtSubject = payload.sub;
    authSpan.setStatus({ code: SpanStatusCode.OK });
  } catch {
    authSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: "invalid token",
    });
    reply
      .status(401)
      .send({ statusCode: 401, message: "Invalid or expired token" });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "401" });
    span.end();
    return false;
  } finally {
    authSpan.end();
  }
  return true;
}

const DYNAMIC_ROUTE_HOP_BY_HOP = new Set([
  "host",
  "connection",
  "transfer-encoding",
]);

function buildUpstreamRequestInit(req: FastifyRequest): RequestInit {
  const upstreamHeaders = copyForwardableHeaders(req, DYNAMIC_ROUTE_HOP_BY_HOP);

  const init: RequestInit = {
    method: req.method,
    headers: upstreamHeaders,
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  };

  if (
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.method !== "DELETE" &&
    req.body !== undefined
  ) {
    init.body = JSON.stringify(req.body);
  }
  return init;
}

interface IProxyToUpstreamClusterOptions {
  req: FastifyRequest;
  reply: FastifyReply;
  yReq: IYoizenRequest;
  matched: IMatchedRoute;
  tenantId: string;
  tracer: ReturnType<typeof trace.getTracer>;
  span: ReturnType<ReturnType<typeof trace.getTracer>["startSpan"]>;
  jwtService: JwtService;
  logger: ILoggerLike;
}

async function proxyToUpstreamCluster(
  opts: IProxyToUpstreamClusterOptions,
): Promise<void> {
  const { req, reply, yReq, matched, tenantId, tracer, span, jwtService, logger } =
    opts;
  const ok = await verifyBearerForPrivateRoute({
    req,
    reply,
    yReq,
    tenantId,
    matched,
    jwtService,
    tracer,
    span,
  });
  if (!ok) return;

  const queryString = req.url.includes("?")
    ? req.url.slice(req.url.indexOf("?"))
    : "";
  const host = `${matched.knativeName}.${matched.namespace}.svc.cluster.local`;
  const portSuffix =
    matched.port !== 80 && matched.port > 0 ? `:${matched.port}` : "";
  const upstreamUrl = `http://${host}${portSuffix}${matched.upstreamPath}${queryString}`;

  const proxyStart = performance.now();
  const init = buildUpstreamRequestInit(req);

  try {
    const upstream = await tracedFetch(upstreamUrl, init);
    await pipeUpstreamResponseToReply(reply, upstream);

    span.setAttribute("http.status_code", upstream.status);
    span.setStatus({ code: SpanStatusCode.OK });

    yReq.__upstream = {
      url: upstreamUrl,
      statusCode: upstream.status,
      durationMs: Math.round((performance.now() - proxyStart) * 100) / 100,
    };
  } catch (err) {
    logger.error(
      `Dynamic route proxy error for ${req.method} ${upstreamUrl}: ${err}`,
    );
    reply.status(502).send({ statusCode: 502, message: "Bad Gateway" });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "502" });
    yReq.__upstream = {
      url: upstreamUrl,
      statusCode: 502,
      durationMs: Math.round((performance.now() - proxyStart) * 100) / 100,
    };
  } finally {
    span.end();
  }
}

/**
 * Fastify onRequest hook that handles tenant resolution, rate limiting,
 * JWT verification, and upstream proxying for dynamic (non-platform) routes.
 */
export function configureDynamicRouteHook(
  fastify: FastifyInstance,
  ctx: IDynamicRouteHookContext,
): void {
  const { routeCache, jwtService, rateLimitService, tracer, logger } = ctx;

  fastify.addHook(
    "onRequest",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const yReq = req as IYoizenRequest;
      const tenantId = resolveTenantFromRequest(req);
      yReq.__tenantId = tenantId;
      yReq.__rateLimitApplied = false;

      const continueAfterRl = await applyTenantRateLimit({
        tenantId,
        rateLimitService,
        req: yReq,
        reply,
      });
      if (!continueAfterRl) return;

      const path = req.url.split("?")[0];
      if (isPlatformRoutePath(path)) return;
      if (!tenantId) return;

      const matched = routeCache.match(tenantId, req.method, path);
      if (!matched) return;

      const span = tracer.startSpan("gateway.dynamic_route", {
        kind: SpanKind.SERVER,
        attributes: {
          "http.method": req.method,
          "http.url": req.url,
          "tenant.id": tenantId,
          "route.knative_name": matched.knativeName,
          "route.is_public": matched.isPublic,
        },
      });
      yReq.__dynamicRouteSpan = span;

      const spanCtx = trace.setSpan(context.active(), span);

      await context.with(spanCtx, async () => {
        await proxyToUpstreamCluster({
          req,
          reply,
          yReq,
          matched,
          tenantId,
          tracer,
          span,
          jwtService,
          logger,
        });
      });
    },
  );
}
