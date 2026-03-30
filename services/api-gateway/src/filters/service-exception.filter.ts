import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { getActiveTraceId } from "@yoizen/observability";

/**
 * Callback that can rewrite an error response before it leaves the gateway.
 * Return a new `{ status, body }` to override, or return the inputs unchanged
 * to keep the default pass-through behaviour.
 */
export type ErrorTransformer = (
  status: number,
  body: Record<string, unknown>,
) => { status: number; body: Record<string, unknown> };

/**
 * Global exception filter for the API gateway.
 *
 * - `HttpException`: forwards status + body as-is (downstream errors propagate).
 * - Transformers registered per status code can intercept and rewrite specific errors.
 * - Any non-`HttpException` (plain `Error`, unexpected throw) becomes a generic 500.
 */
@Catch()
export class ServiceExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ServiceExceptionFilter.name);

  private readonly transformers = new Map<number, ErrorTransformer>([
    // Register per-status-code transformers here. Examples:
    //
    // [503, (_s, _b) => ({
    //   status: 503,
    //   body: { statusCode: 503, message: "Service temporarily unavailable" },
    // })],
  ]);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (reply.sent) return;

    const traceId = getActiveTraceId() ?? "";

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();

      let body: Record<string, unknown> =
        typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>)
          : { statusCode: status, message: String(raw) };

      if (!("statusCode" in body)) {
        body = { statusCode: status, ...body };
      }

      const transformer = this.transformers.get(status);
      if (transformer) {
        const result = transformer(status, body);
        reply.status(result.status).send(result.body);
        return;
      }

      reply.status(status).send(body);
      return;
    }

    const message =
      exception instanceof Error ? exception.message : "Internal server error";

    this.logger.error(
      `Unhandled exception [traceId=${traceId}]: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    reply.status(500).send({
      statusCode: 500,
      message: "Internal server error",
    });
  }
}
