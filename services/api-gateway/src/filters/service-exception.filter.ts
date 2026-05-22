import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { getActiveTraceId, PinoLoggerService } from "@yoizen/observability";

/**
 * Global exception filter for the API gateway.
 *
 * - `HttpException`: forwards status + body as-is (downstream errors propagate).
 * - Any non-`HttpException` (plain `Error`, unexpected throw) becomes a generic 500.
 */
@Catch()
export class ServiceExceptionFilter implements ExceptionFilter {
  private readonly logger = new PinoLoggerService(ServiceExceptionFilter.name);

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

      /**
       * Honour a `retryAfterSeconds` hint embedded in the response
       * body by callers like `WebhookPublishUnavailableError`
       * (see `post-mortem/POST-MORTEM.md` §P1.2). Providers like
       * WhatsApp / Telegram / Meta respect the standard `Retry-After`
       * header and back off appropriately, which is what we want
       * when JetStream publish acks stall.
       */
      const retryAfter = body.retryAfterSeconds;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        reply.header("Retry-After", String(Math.ceil(retryAfter)));
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
