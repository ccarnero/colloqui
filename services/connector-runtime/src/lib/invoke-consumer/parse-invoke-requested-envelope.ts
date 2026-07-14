// Parses/validates one `invoke_requested` JetStream message
// (`manual-loops/connector-invoke-api.md` T05) into the shape the consumer
// handler needs. Pure — takes the already-decoded envelope + the message
// subject, never touches `JsMsg`/`nats` types, so it's unit-testable without
// a broker. `invoke-consumer-main.ts` is the only caller: it decodes
// `msg.data` to JSON, checks `isCompliantEnvelope`, and passes the result
// here; a `null`/error return there becomes a `PermanentError` (poison
// message -> DLQ, never redelivered) since none of these failures are
// transient.

import type { EndpointCallArgs, EventEnvelope } from "@yoizen/shared";
import { parseSubject } from "@yoizen/shared";
import { err, ok, type Result } from "../result";
import type { InvokeWebhookTarget } from "./types";

export interface ParsedInvokeRequestedMessage {
  readonly tenantId: string;
  readonly invocationId: string;
  readonly connectorId: string;
  readonly endpointId: string;
  readonly args: EndpointCallArgs;
  readonly webhook?: InvokeWebhookTarget;
  readonly causal: {
    readonly correlation_id: string;
    readonly causation_id: string;
    readonly depth: number;
  };
}

const RESOURCE_PATTERN = /^invocation\/(.+)$/;

/**
 * Validates envelope/subject consistency and extracts the typed payload
 * published by `publishInvokeRequestEvent`
 * (`src/activities/_shared/invoke-request-publisher.ts`). Every failure
 * mode here means the message can NEVER succeed on redelivery (malformed
 * producer output, tenant/subject mismatch, missing required fields) —
 * the caller maps `err(...)` to a `PermanentError` rather than a retryable
 * throw.
 */
export function parseInvokeRequestedEnvelope(
  envelope: EventEnvelope,
  subject: string
): Result<ParsedInvokeRequestedMessage, string> {
  const parsedSubject = parseSubject(subject);
  if (!parsedSubject) {
    return err(
      `subject "${subject}" does not match the canonical 8-token shape`
    );
  }
  if (parsedSubject.tenant !== envelope.tenant) {
    return err(
      `tenant mismatch: subject tenant="${parsedSubject.tenant}" envelope tenant="${envelope.tenant}"`
    );
  }

  const resourceMatch = RESOURCE_PATTERN.exec(envelope.resource);
  if (!resourceMatch) {
    return err(
      `envelope resource "${envelope.resource}" does not match "invocation/<id>"`
    );
  }
  const invocationId = resourceMatch[1]!;

  const payload = envelope.data?.payload as
    | {
        readonly connectorId?: unknown;
        readonly endpointId?: unknown;
        readonly args?: unknown;
        readonly webhook?: unknown;
      }
    | null
    | undefined;

  if (!payload || typeof payload !== "object") {
    return err("envelope data.payload is missing or not an object");
  }
  if (
    typeof payload.connectorId !== "string" ||
    payload.connectorId.length === 0
  ) {
    return err(
      "payload.connectorId is required and must be a non-empty string"
    );
  }
  if (
    typeof payload.endpointId !== "string" ||
    payload.endpointId.length === 0
  ) {
    return err("payload.endpointId is required and must be a non-empty string");
  }
  if (!payload.args || typeof payload.args !== "object") {
    return err("payload.args is required and must be an object");
  }
  const args = payload.args as EndpointCallArgs;
  if (typeof args.method !== "string" || args.method.length === 0) {
    return err(
      "payload.args.method is required and must be a non-empty string"
    );
  }

  let webhook: InvokeWebhookTarget | undefined;
  if (payload.webhook !== undefined) {
    const rawWebhook = payload.webhook as { url?: unknown; headers?: unknown };
    if (typeof rawWebhook.url !== "string" || rawWebhook.url.length === 0) {
      return err(
        "payload.webhook.url must be a non-empty string when provided"
      );
    }
    webhook = {
      url: rawWebhook.url,
      ...(rawWebhook.headers !== undefined && {
        headers: rawWebhook.headers as Record<string, string>,
      }),
    };
  }

  return ok({
    tenantId: envelope.tenant,
    invocationId,
    connectorId: payload.connectorId,
    endpointId: payload.endpointId,
    args,
    ...(webhook !== undefined && { webhook }),
    causal: {
      correlation_id: envelope.correlation_id,
      causation_id: envelope.id,
      depth: envelope.transport?.depth ?? 0,
    },
  });
}
