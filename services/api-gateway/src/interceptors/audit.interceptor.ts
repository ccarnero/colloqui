import {
  Injectable,
  Inject,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from "@nestjs/common";
import { type Observable, tap } from "rxjs";
import type { JetStreamClient } from "nats";
import type { FastifyReply } from "fastify";
import type { IYoizenRequest } from "../types/yoizen-request";
import type { GatewayAuditEvent } from "@yoizen/shared";
import { JETSTREAM } from "../providers/nats.provider";
import { REQUEST_USER_KEY } from "../guards/auth.guard";
import { REQUEST_TENANT_KEY } from "../guards/tenant.guard";
import { getActiveTraceId, PinoLoggerService } from "@yoizen/observability";
import { gatewayConfig } from "../config/gateway.config";
import { publishGatewayAuditEvent } from "../utils/gateway-audit-publish.util";

const SKIP_AUDIT_PATHS = new Set(["/health", "/healthz"]);
const WEBHOOK_AUDIT_PREFIX = "/api/webhooks/";

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new PinoLoggerService(AuditInterceptor.name);

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<IYoizenRequest>();
    const path = request.url.split("?")[0];

    if (!gatewayConfig.audit.enabled) {
      return next.handle();
    }

    if (SKIP_AUDIT_PATHS.has(path)) {
      return next.handle();
    }

    if (
      gatewayConfig.audit.skipWebhookPaths &&
      path.startsWith(WEBHOOK_AUDIT_PREFIX)
    ) {
      return next.handle();
    }

    const startTime = performance.now();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    return next.handle().pipe(
      tap({
        next: () => this.publishAudit(request, reply, startTime),
        error: (err) => this.publishAudit(request, reply, startTime, err),
      }),
    );
  }

  private publishAudit(
    request: IYoizenRequest,
    reply: FastifyReply,
    startTime: number,
    error?: unknown,
  ): void {
    const durationMs = performance.now() - startTime;
    const user = request[REQUEST_USER_KEY];
    const tenantId: string | null = request[REQUEST_TENANT_KEY] ?? null;

    const event: GatewayAuditEvent = {
      requestId: request.id,
      traceId: getActiveTraceId() ?? "",
      timestamp: new Date().toISOString(),
      tenantId,
      method: request.method,
      path: request.url.split("?")[0],
      statusCode: reply.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      clientIp: request.ip ?? "",
      userAgent: (request.headers["user-agent"] as string) ?? "",
      jwtSubject: user?.sub ?? null,
      routeType: "platform",
      rateLimitApplied:
        request.__rateLimitApplied ??
        parseRateLimitHeader(reply) !== undefined,
      rateLimitRemaining: parseRateLimitHeader(reply),
      error: error ? String(error) : undefined,
      // Webhook ingress correlation — null for all other HTTP paths (no fabrication).
      correlationId: request.__correlationId ?? null,
      causationId: request.__causationId ?? null,
      depth: request.__depth ?? null,
    };

    publishGatewayAuditEvent({
      js: this.js,
      event,
      tenantId,
      onError: (err: unknown) => {
        this.logger.warn(
          `Gateway audit JetStream publish failed: ${err instanceof Error ? err.message : err}`,
        );
      },
    });
  }
}

function parseRateLimitHeader(reply: FastifyReply): number | undefined {
  const val = reply.getHeader("X-RateLimit-Remaining");
  if (val === undefined || val === null) return undefined;
  const num = Number(val);
  return Number.isFinite(num) ? num : undefined;
}
