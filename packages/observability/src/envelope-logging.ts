import { randomBytes } from "node:crypto";
import type { PinoLoggerService } from "./logger";
import { getActiveTraceId } from "./trace-utils";

/**
 * Minimal shape a log helper needs from an envelope. Mirrors the
 * canonical `EventEnvelope` (DOCS/arquitectura/02 §2) fields required for
 * structured logging (DOCS/arquitectura/06 §3.1).
 */
export interface IEnvelopeLogContext {
  readonly id?: string;
  readonly tenant?: string;
  readonly traceid?: string;
  readonly correlation_id?: string;
  readonly causation_id?: string | null;
  readonly channel?: string;
  readonly provider?: string;
  readonly producer?: string;
  readonly domain?: string;
  readonly idempotencykey?: string;
  readonly transport?: { depth?: number };
}

/** Required structured fields per DOCS/arquitectura/06 §3.1. */
export interface IStructuredLogFields {
  event_id?: string;
  trace_id?: string;
  causation_id?: string | null;
  correlation_id?: string;
  tenant?: string;
  channel?: string;
  provider?: string;
  producer?: string;
  domain?: string;
  idempotency_key?: string;
  depth?: number;
  step: string;
}

/**
 * Extracts the canonical set of structured log fields required by
 * DOCS/arquitectura/06-observabilidad.md §3.1 from an envelope.
 * Tolerates the legacy camelCase aliases in `ChannelEnvelope`.
 */
export function envelopeLogFields(
  envelope: IEnvelopeLogContext | null | undefined,
  step: string,
): IStructuredLogFields {
  if (!envelope) return { step };

  const fields: IStructuredLogFields = {
    step,
    ...(envelope.id !== undefined && { event_id: envelope.id }),
    ...(envelope.traceid !== undefined && { trace_id: envelope.traceid }),
    ...(envelope.causation_id !== undefined && {
      causation_id: envelope.causation_id,
    }),
    ...(envelope.correlation_id !== undefined && {
      correlation_id: envelope.correlation_id,
    }),
    ...(envelope.tenant !== undefined && { tenant: envelope.tenant }),
    ...(envelope.channel !== undefined && { channel: envelope.channel }),
    ...(envelope.provider !== undefined && { provider: envelope.provider }),
    ...(envelope.producer !== undefined && { producer: envelope.producer }),
    ...(envelope.domain !== undefined && { domain: envelope.domain }),
    ...(envelope.idempotencykey !== undefined && {
      idempotency_key: envelope.idempotencykey,
    }),
    ...(envelope.transport?.depth !== undefined && {
      depth: envelope.transport.depth,
    }),
  };

  return fields;
}

/**
 * Serializes structured fields into a deterministic single-line string.
 * Small, O(n) on the number of defined fields. Used as the `context`
 * argument to `PinoLoggerService` methods (which only accept strings).
 */
function serializeFields(fields: IStructuredLogFields): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out.push(`${key}=${String(value)}`);
  }
  return out.join(" ");
}

/**
 * Emits a log line enriched with the required structured fields for the
 * envelope. `level` defaults to `log`. The fields are stringified into
 * the `context` slot that `PinoLoggerService` already exposes, so no
 * breaking change is required to the logger API.
 */
export function logWithEnvelope(
  logger: Pick<PinoLoggerService, "log" | "warn" | "error" | "debug">,
  envelope: IEnvelopeLogContext | null | undefined,
  step: string,
  message: string,
  level: "log" | "warn" | "error" | "debug" = "log",
): void {
  const ctx = serializeFields(envelopeLogFields(envelope, step));
  logger[level](message, ctx);
}

/**
 * Returns the active OTEL traceId or, if none, a cryptographically
 * random 32-hex-char traceId so publishers always populate
 * `envelope.traceid` with a valid-looking value.
 *
 * Callers that have access to the OTEL API should prefer
 * `getActiveTraceId()` alone and only fall back when necessary.
 */
export function activeOrRandomTraceId(): string {
  return getActiveTraceId() ?? randomBytes(16).toString("hex");
}
