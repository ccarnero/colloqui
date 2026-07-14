import { randomUUID } from "node:crypto";
import { PinoLoggerService } from "@yoizen/observability";
import { publishEndpointCallEvent } from "./activities/_shared/event-publisher";
import { workflowHttpWorkerConfig } from "./config";
import { createRateLimitState } from "./lib/http-facade/check-rate-limit";
import { handleInvokeRequest } from "./lib/http-facade/handle-invoke-request";
import { matchInvokeRoute } from "./lib/http-facade/match-invoke-route";

const logger = new PinoLoggerService("connector-runtime-http-facade");

/**
 * HTTP invoke facade — SECOND entrypoint of the connector-runtime
 * deployable (`manual-loops/connector-invoke-api.md` T02), alongside the
 * Temporal worker (`worker.ts`). Serves `POST /invoke/:connectorId/:endpointId`
 * (sync mode only in T02) and `GET /health`, following the plain-`Bun.serve`
 * style of `temporal-worker-health.ts` — no Express/Fastify despite this
 * package's `fastify`/`@nestjs/*` deps (unused legacy deps, not touched by
 * this task per SPEC.md's "do NOT add Express" constraint).
 *
 * All orchestration (tenant guard, rate limit, body validation, core
 * execution → HTTP status mapping) lives in the pure
 * `src/lib/http-facade/handle-invoke-request.ts`; this file is the only I/O
 * edge — `Bun.serve` binding, header/JSON body reads, and injecting the real
 * `publishEndpointCallEvent` NATS sink.
 *
 * Deployment note: same image as the Temporal worker, run as a second
 * container/profile (`bun run src/http-main.ts`) so the worker (which scales
 * on Temporal task-queue depth) and the facade (which scales on inbound RPS)
 * get independent HPA targets. See the service README's "Scaling" section.
 */
const rateLimitState = createRateLimitState();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleInvoke(
  request: Request,
  connectorId: string,
  endpointId: string
): Promise<Response> {
  let rawBody: unknown = null;
  try {
    rawBody = await request.json();
  } catch (cause) {
    logger.warn(
      `invoke REJECTED connector=${connectorId} endpoint=${endpointId} — invalid JSON body: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const result = await handleInvokeRequest({
    tenantHeader: request.headers.get("x-yoizen-tenant"),
    connectorId,
    endpointId,
    rawBody,
    rateLimitState,
    rateLimitConfig: workflowHttpWorkerConfig.rateLimitPerTenant,
    generateInvocationId: randomUUID,
    publish: publishEndpointCallEvent,
    log: (message) => logger.log(message),
    warn: (message) => logger.warn(message),
  });

  return jsonResponse(result.status, result.body);
}

const server = Bun.serve({
  port: workflowHttpWorkerConfig.httpFacadePort,
  fetch(request): Response | Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(200, { status: "ok" });
    }

    if (request.method === "POST") {
      const route = matchInvokeRoute(url.pathname);
      if (route) {
        return handleInvoke(request, route.connectorId, route.endpointId);
      }
    }

    return jsonResponse(404, { error: "not found" });
  },
});

logger.log(
  `connector-runtime HTTP invoke facade listening on port ${server.port}`
);

process.on("SIGTERM", () => {
  logger.log("connector-runtime HTTP invoke facade shutting down (SIGTERM)");
  server.stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  logger.log("connector-runtime HTTP invoke facade shutting down (SIGINT)");
  server.stop();
  process.exit(0);
});
