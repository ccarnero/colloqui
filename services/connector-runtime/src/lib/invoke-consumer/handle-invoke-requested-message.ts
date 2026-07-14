// Orchestrates one `invoke_requested` message end-to-end (the async invoke
// consumer, `manual-loops/connector-invoke-api.md` T05): run the SAME pure
// core the sync facade and the Temporal activity use, park the result in
// Redis (idempotent by invocationId), best-effort publish the
// `invoke_completed` transport event, best-effort deliver the caller's
// webhook. WITHOUT touching `JsMsg`/`nats` directly — `invoke-consumer-main.ts`
// decodes/validates the envelope (`parseInvokeRequestedEnvelope`) and wires
// the real Redis/NATS/fetch ports; this file only orchestrates.
//
// ACK SEMANTICS (SPEC.md "explicit ack AFTER parking the result"): this
// function resolves (allowing the caller's `NatsConsumerRunner` to
// `msg.ack()`) ONLY after `parkInvocationResult` has succeeded. A failure to
// park is NOT swallowed — it propagates so the message is nak'd and
// JetStream redelivers, which means the outbound HTTP call may run AGAIN on
// the next delivery (the documented "duplicate-HTTP window": at-least-once,
// not exactly-once, per SPEC.md's explicit non-goal). Once parked, publishing
// `invoke_completed` and delivering the webhook are best-effort: failures
// there are logged as warnings and NEVER cause a nak, because the durable,
// pollable copy of the result already exists in Redis (SPEC.md "webhook
// delivery failure -> warn + polling still works").
import { logWithEnvelope, type PinoLoggerService } from "@yoizen/observability";
import type { EndpointCallEventSink } from "../endpoint-call-core";
import { executeEndpointCallCore } from "../endpoint-call-core";
import { buildInvocationCompletedRecord } from "./build-invocation-completed-record";
import type { DeliverWebhook } from "./deliver-webhook";
import type { ParkInvocationResult } from "./park-invocation-result";
import type { ParsedInvokeRequestedMessage } from "./parse-invoke-requested-envelope";
import type { PublishInvokeCompleted } from "./publish-invoke-completed";

export interface HandleInvokeRequestedMessageDeps {
  readonly parsed: ParsedInvokeRequestedMessage;
  readonly resultTtlSeconds: number;
  readonly executeCore?: typeof executeEndpointCallCore;
  /** Audit-event sink — same `connector.endpoint_call.completed.v1` event as sync/Temporal (SPEC.md constraint: no new audit kinds). */
  readonly publish: EndpointCallEventSink;
  readonly parkInvocationResult: ParkInvocationResult;
  readonly publishInvokeCompleted: PublishInvokeCompleted;
  readonly deliverWebhook?: DeliverWebhook;
  readonly logger: Pick<PinoLoggerService, "log" | "warn" | "error" | "debug">;
  /** Envelope-shaped object for `logWithEnvelope` correlation (the original invoke_requested envelope). */
  readonly logEnvelope: Parameters<typeof logWithEnvelope>[1];
}

export async function handleInvokeRequestedMessage(
  deps: HandleInvokeRequestedMessageDeps
): Promise<void> {
  const { parsed } = deps;
  const execute = deps.executeCore ?? executeEndpointCallCore;

  logWithEnvelope(
    deps.logger,
    deps.logEnvelope,
    "connector.endpoint.invoke_requested.consume",
    `invoke consume START invocationId=${parsed.invocationId} tenant=${parsed.tenantId} connector=${parsed.connectorId} endpoint=${parsed.endpointId}`
  );

  const coreResult = await execute(
    parsed.args,
    parsed.tenantId,
    parsed.causal,
    deps.publish,
    undefined,
    parsed.invocationId
  );

  const record = buildInvocationCompletedRecord(
    parsed.tenantId,
    parsed.invocationId,
    coreResult
  );

  // Critical gate: parking failure propagates (nak -> redelivery). Never
  // caught here — see the module header's ack-semantics note.
  await deps.parkInvocationResult(record, deps.resultTtlSeconds);
  logWithEnvelope(
    deps.logger,
    deps.logEnvelope,
    "connector.endpoint.invoke_requested.park",
    `invoke result PARKED invocationId=${parsed.invocationId} tenant=${parsed.tenantId} outcome=${record.outcome}`
  );

  try {
    const published = await deps.publishInvokeCompleted({
      tenantId: parsed.tenantId,
      invocationId: parsed.invocationId,
      connectorId: parsed.connectorId,
      endpointId: parsed.endpointId,
      record,
      causal: parsed.causal,
    });
    if (!published.ok) {
      deps.logger.warn(
        `invoke_completed publish FAILED invocationId=${parsed.invocationId} tenant=${parsed.tenantId} — ${published.error.message} (result is still parked; polling works)`
      );
    }
  } catch (cause) {
    deps.logger.warn(
      `invoke_completed publish THREW invocationId=${parsed.invocationId} tenant=${parsed.tenantId} — ${cause instanceof Error ? cause.message : String(cause)} (result is still parked; polling works)`
    );
  }

  if (parsed.webhook) {
    if (!deps.deliverWebhook) {
      deps.logger.warn(
        `invoke webhook target present but no deliverWebhook port wired invocationId=${parsed.invocationId} tenant=${parsed.tenantId} — skipping delivery, polling still works`
      );
    } else {
      try {
        const delivered = await deps.deliverWebhook(parsed.webhook, record);
        if (!delivered.ok) {
          deps.logger.warn(
            `invoke webhook delivery FAILED invocationId=${parsed.invocationId} tenant=${parsed.tenantId} url=${parsed.webhook.url} — ${delivered.error.message} (SPEC.md: warn + polling still works)`
          );
        } else {
          deps.logger.log(
            `invoke webhook delivered invocationId=${parsed.invocationId} tenant=${parsed.tenantId} url=${parsed.webhook.url} status=${delivered.value.status}`
          );
        }
      } catch (cause) {
        deps.logger.warn(
          `invoke webhook delivery THREW invocationId=${parsed.invocationId} tenant=${parsed.tenantId} url=${parsed.webhook.url} — ${cause instanceof Error ? cause.message : String(cause)} (SPEC.md: warn + polling still works)`
        );
      }
    }
  }

  logWithEnvelope(
    deps.logger,
    deps.logEnvelope,
    "connector.endpoint.invoke_requested.consume",
    `invoke consume DONE invocationId=${parsed.invocationId} tenant=${parsed.tenantId} outcome=${record.outcome}`
  );
}
