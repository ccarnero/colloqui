import {
  Injectable,
  Inject,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';
import type { JetStreamClient } from 'nats';
import { headers as natsHeaders } from 'nats';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { GATEWAY_AUDIT_SUBJECT, TENANT_HEADER } from '@yoizen/shared';
import type { GatewayAuditEvent } from '@yoizen/shared';
import { JETSTREAM } from '../providers/nats.provider';
import { REQUEST_USER_KEY } from '../guards/auth.guard';
import { REQUEST_TENANT_KEY } from '../guards/tenant.guard';
import { getActiveTraceId } from '@yoizen/observability';

const encoder = new TextEncoder();

const SKIP_AUDIT_PATHS = new Set(["/health", "/healthz"]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const path = request.url.split("?")[0];

    if (SKIP_AUDIT_PATHS.has(path)) {
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
    request: FastifyRequest,
    reply: FastifyReply,
    startTime: number,
    error?: unknown,
  ): void {
    const durationMs = performance.now() - startTime;
    const user = (request as any)[REQUEST_USER_KEY];
    const tenantId: string | null = (request as any)[REQUEST_TENANT_KEY] ?? null;

    const event: GatewayAuditEvent = {
      requestId: request.id,
      traceId: getActiveTraceId() ?? '',
      timestamp: new Date().toISOString(),
      tenantId,
      method: request.method,
      path: request.url.split('?')[0],
      statusCode: reply.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      clientIp: request.ip ?? '',
      userAgent: (request.headers['user-agent'] as string) ?? '',
      jwtSubject: user?.sub ?? null,
      routeType: 'platform',
      rateLimitApplied: tenantId !== null,
      rateLimitRemaining: parseRateLimitHeader(reply),
      error: error ? String(error) : undefined,
    };

    const hdrs = natsHeaders();
    if (tenantId) hdrs.set(TENANT_HEADER, tenantId);

    this.js
      .publish(GATEWAY_AUDIT_SUBJECT, encoder.encode(JSON.stringify(event)), { headers: hdrs })
      .catch(() => {});
  }
}

function parseRateLimitHeader(reply: FastifyReply): number | undefined {
  const val = reply.getHeader('X-RateLimit-Remaining');
  if (val === undefined || val === null) return undefined;
  const num = Number(val);
  return Number.isFinite(num) ? num : undefined;
}
