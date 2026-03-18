import { type LoggerService } from '@nestjs/common';
import pino, { type Logger as PinoInstance } from 'pino';
import { trace, context } from '@opentelemetry/api';

function traceContext(): { traceId?: string; spanId?: string } {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const ctx = span.spanContext();
  if (!ctx.traceId || ctx.traceId === '00000000000000000000000000000000') return {};
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

export function createPinoLogger(serviceName: string): PinoInstance {
  return pino({
    name: serviceName,
    level: process.env.LOG_LEVEL ?? 'info',
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    mixin() {
      return traceContext();
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export class PinoLoggerService implements LoggerService {
  private readonly logger: PinoInstance;

  constructor(serviceName: string) {
    this.logger = createPinoLogger(serviceName);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.info({ context: ctx }, String(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const { stack, ctx } = this.extractErrorParams(optionalParams);
    if (stack) {
      this.logger.error({ context: ctx, err: { stack } }, String(message));
    } else {
      this.logger.error({ context: ctx }, String(message));
    }
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.warn({ context: ctx }, String(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.debug({ context: ctx }, String(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.trace({ context: ctx }, String(message));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.fatal({ context: ctx }, String(message));
  }

  private extractContext(params: unknown[]): string | undefined {
    const last = params[params.length - 1];
    return typeof last === 'string' ? last : undefined;
  }

  private extractErrorParams(params: unknown[]): { stack?: string; ctx?: string } {
    let stack: string | undefined;
    let ctx: string | undefined;
    for (const p of params) {
      if (typeof p === 'string') {
        if (p.includes('\n') || p.startsWith('Error')) {
          stack = p;
        } else {
          ctx = p;
        }
      }
    }
    return { stack, ctx };
  }
}
