import {
  type IMultiTenantConsumerConfig,
  MultiTenantConsumerManager,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import {
  type EventEnvelope,
  isCompliantEnvelope,
  PermanentError,
} from "@yoizen/shared";
import { connect, type JsMsg } from "nats";
import { publishEndpointCallEvent } from "./activities/_shared/event-publisher";
import { parkInvocationResult } from "./activities/_shared/invocation-store";
import {
  INGRESS_STREAM_PATTERN,
  INVOKE_REQUESTED_SUBJECT_FILTER,
  publishInvokeCompletedEvent,
} from "./activities/_shared/invoke-request-publisher";
import { deliverWebhook } from "./activities/_shared/webhook-delivery";
import { workflowHttpWorkerConfig } from "./config";
import { handleInvokeRequestedMessage } from "./lib/invoke-consumer/handle-invoke-requested-message";
import {
  type ParsedInvokeRequestedMessage,
  parseInvokeRequestedEnvelope,
} from "./lib/invoke-consumer/parse-invoke-requested-envelope";

/**
 * Async invoke consumer — THIRD entrypoint of the connector-runtime
 * deployable (`manual-loops/connector-invoke-api.md` T05), alongside the
 * Temporal worker (`worker.ts`) and the HTTP invoke facade (`http-main.ts`).
 * Consumes `invoke_requested` messages, runs the SAME pure core the sync
 * facade uses, parks the result in Redis, publishes `invoke_completed`, and
 * best-effort delivers the caller's webhook.
 *
 * Durable name: `connector-runtime-invoke` (one shared name across every
 * `INGRESS-<tenant>` stream — pull-consumer sharding means multiple pods
 * calling `consume()` on the same `(stream, durable)` load-balance
 * automatically, same pattern as `channel-service`'s
 * `webhook-ingress-consumer.service.ts`).
 *
 * Filter subject: `INVOKE_REQUESTED_SUBJECT_FILTER`
 * (`evt.*.connector-runtime.platform.endpoint.system.invoke_requested.v1`,
 * cross-tenant wildcard) bound against every stream matching
 * `INGRESS_STREAM_PATTERN` (`^INGRESS-`) — the design-change topology from
 * `invoke-request-publisher.ts`'s module header: invoke subjects ride the
 * existing per-tenant ingress streams, never a dedicated stream. Consumers
 * are additive — this NEVER alters an existing stream's config, only adds a
 * durable consumer alongside whatever else already consumes that stream.
 */
const DURABLE_NAME = "connector-runtime-invoke";
const logger = new PinoLoggerService("connector-runtime-invoke-consumer");
const decoder = new TextDecoder();

/**
 * Decodes + validates one `invoke_requested` `JsMsg` into the shape
 * `handleInvokeRequestedMessage` needs. Throws `PermanentError` (-> `msg.term()`
 * + per-tenant DLQ, never redelivered) for anything that can NEVER succeed
 * on retry: malformed JSON, a non-compliant envelope, or a payload that
 * fails `parseInvokeRequestedEnvelope`'s validation. This is the ONLY place
 * in this file that decides retryable-vs-permanent; everything past this
 * point either succeeds or throws a plain `Error` (retryable — the message
 * is nak'd and JetStream redelivers with backoff).
 */
function parseMessageOrThrow(msg: JsMsg): {
  envelope: EventEnvelope;
  parsed: ParsedInvokeRequestedMessage;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(msg.data));
  } catch (cause) {
    throw new PermanentError(
      `invoke_requested message is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      "invoke-consumer-decode"
    );
  }

  if (!isCompliantEnvelope(raw)) {
    throw new PermanentError(
      "invoke_requested message is not a compliant EventEnvelope",
      "invoke-consumer-decode"
    );
  }
  const envelope = raw as EventEnvelope;

  const parsedResult = parseInvokeRequestedEnvelope(envelope, msg.subject);
  if (!parsedResult.ok) {
    throw new PermanentError(
      `invoke_requested envelope failed validation: ${parsedResult.error}`,
      "invoke-consumer-parse"
    );
  }

  return { envelope, parsed: parsedResult.value };
}

async function handleJsMessage(msg: JsMsg): Promise<void> {
  const { envelope, parsed } = parseMessageOrThrow(msg);

  await handleInvokeRequestedMessage({
    parsed,
    resultTtlSeconds: workflowHttpWorkerConfig.invocationResultTtlSeconds,
    publish: publishEndpointCallEvent,
    parkInvocationResult,
    publishInvokeCompleted: publishInvokeCompletedEvent,
    deliverWebhook,
    logger,
    logEnvelope: envelope,
  });
}

async function main(): Promise<void> {
  logger.log(
    `connecting to NATS ${workflowHttpWorkerConfig.natsUrl} (invoke consumer)`
  );
  const nc = await connect({
    servers: workflowHttpWorkerConfig.natsUrl,
    name: "connector-runtime-invoke-consumer",
    waitOnFirstConnect: true,
  });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();

  const config: IMultiTenantConsumerConfig = {
    streamPattern: INGRESS_STREAM_PATTERN,
    durableName: DURABLE_NAME,
    filterSubject: INVOKE_REQUESTED_SUBJECT_FILTER,
    description: "connector-runtime async invoke consumer (T05)",
    // The handler chains adapter-defined I/O: the endpoint call's timeoutMs
    // comes from the adapter (no upper cap) and multiplies by maxRetries +
    // retryBackoffMs, then the T05 webhook delivery adds its own timeout.
    // The 60s package default risks in-flight redelivery = duplicated
    // outbound HTTP. 5 minutes covers the worst realistic chain.
    ackWaitMs: 300_000,
    // Async invoke work is I/O-bound (outbound HTTP + Redis + NATS
    // publishes) and independent per-invocation — safe to run several in
    // flight per pod, mirroring `webhook-ingress-consumer.service.ts`'s
    // reasoning for its own concurrency default.
    runnerOptions: { concurrency: 16 },
  };

  const manager = new MultiTenantConsumerManager(
    jsm,
    js,
    config,
    handleJsMessage,
    logger
  );
  await manager.start();
  logger.log(
    `invoke consumer durable '${DURABLE_NAME}' started, filter=${INVOKE_REQUESTED_SUBJECT_FILTER}`
  );

  const healthPort = workflowHttpWorkerConfig.invokeConsumerHealthPort;
  const server = Bun.serve({
    port: healthPort,
    fetch(request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });
  logger.log(`invoke consumer health server listening on port ${server.port}`);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`invoke consumer shutting down (${signal})`);
    server.stop();
    await manager.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((cause) => {
  logger.error(
    `invoke consumer failed to start: ${cause instanceof Error ? cause.stack : String(cause)}`
  );
  process.exit(1);
});
