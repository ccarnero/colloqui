// Consumer edge for the message-tracking ingester (T07).
//
// Two exports:
//   1. `makeTrackedEventHandler` — the per-message handler (the pure pipeline
//      wrapped with buffered insert, verbose logging, metrics and ack/nak/term).
//      This is the ONLY I/O-touching unit worth unit-testing, so it takes every
//      side effect as an injected argument (buffer, metrics, logger, clock).
//   2. `consumeEvents` — the orchestrator that spins up one durable JetStream
//      consumer group per source (`INGRESS-*`, `GATEWAY_AUDIT`, `DLQ-*`) using
//      `@yoizen/database`'s `MultiTenantConsumerManager` (durable prefix
//      `trk-`, DLQ disabled for our own consumers, `maxAckPending` bounded).
//      The manager is INJECTED (`createManager`) rather than imported so this
//      module stays free of the database package's heavy runtime graph and the
//      handler tests run hermetically. T08 wires the real manager:
//
//        createManager: (spec) => new MultiTenantConsumerManager(
//          jsm, js,
//          { streamPattern: spec.streamPattern, durableName: spec.durableName,
//            description: spec.description, maxAckPending: spec.maxAckPending,
//            dlq: spec.dlq, ensureOnly },
//          spec.handler, logger)
//
// The spec shape mirrors `@yoizen/database`'s `IMultiTenantConsumerConfig`
// (the reuse authority) — see that interface for field semantics.

import type { PinoLoggerService } from "@yoizen/observability";
import { logWithEnvelope } from "@yoizen/observability";
import type { JsMsg } from "nats";
import type { ClassifyOptions } from "./classify.js";
import {
  type ProcessResult,
  processTrackedMessage,
} from "./process-tracked-message.js";
import type { TrackedEventRow } from "./to-tracked-event-row.js";
import type { TrackedEventBuffer } from "./tracked-event-buffer.js";
import {
  type ITrackingIngesterMetricsSink,
  noopTrackingIngesterMetrics,
} from "./tracking-ingester-metrics.js";

/** Durable-name prefix for every tracking-ingester consumer (SPEC.md T07). */
export const TRK_DURABLE_PREFIX = "trk-";
/** Durable over the per-tenant `INGRESS-<TENANT>` streams. */
export const TRK_INGRESS_DURABLE = `${TRK_DURABLE_PREFIX}ingress`;
/** Durable over the single cross-tenant `GATEWAY_AUDIT` stream. */
export const TRK_GATEWAY_AUDIT_DURABLE = `${TRK_DURABLE_PREFIX}gateway-audit`;
/** Durable over the per-tenant `DLQ-<tenant>` streams. */
export const TRK_DLQ_DURABLE = `${TRK_DURABLE_PREFIX}dlq`;

/** Matches the per-tenant ingress streams (`INGRESS-<TENANT>`). */
export const INGRESS_STREAM_PATTERN = /^INGRESS-/;
/** Matches the single cross-tenant gateway-audit stream, exactly. */
export const GATEWAY_AUDIT_STREAM_PATTERN = /^GATEWAY_AUDIT$/;
/** Matches the per-tenant dead-letter streams (`DLQ-<tenant>`). */
export const DLQ_STREAM_PATTERN = /^DLQ-/;

/** Default `maxAckPending` per durable (mirrors usage-aggregator). */
export const DEFAULT_MAX_ACK_PENDING = 1_000;

/** Minimal logger surface the handler needs (a `PinoLoggerService` satisfies it). */
export type TrackedEventLogger = Pick<
  PinoLoggerService,
  "log" | "warn" | "error" | "debug"
>;

const NOOP_LOGGER: TrackedEventLogger = {
  log() {},
  warn() {},
  error() {},
  debug() {},
};

export interface TrackedEventHandlerDeps {
  /** Buffered insert sink — `enqueue` resolves on commit, rejects on failure. */
  readonly buffer: TrackedEventBuffer;
  /** Metrics sink. @default noopTrackingIngesterMetrics */
  readonly metrics?: ITrackingIngesterMetricsSink;
  /** Verbose structured logger. @default no-op */
  readonly logger?: TrackedEventLogger;
  /** Ingest clock for `occurred_at` on non-envelope/malformed rows. @default now */
  readonly now?: () => string;
}

/**
 * Builds the per-message handler: `(JsMsg) => Promise<void>`.
 *
 * Pipeline per message: decode → `processTrackedMessage` (parse → classify →
 * facets → row) → buffered insert → ack / nak / term. Every stage logs with
 * envelope context. The message is ACKed on a committed insert, TERMed after a
 * committed insert of a malformed body (drift never becomes valid on
 * redelivery — avoids a redelivery storm), and NAKed on a transient insert
 * failure so JetStream redelivers.
 */
export function makeTrackedEventHandler(
  deps: TrackedEventHandlerDeps
): (msg: JsMsg) => Promise<void> {
  const metrics = deps.metrics ?? noopTrackingIngesterMetrics;
  const logger = deps.logger ?? NOOP_LOGGER;
  const now = deps.now ?? (() => new Date().toISOString());

  return async (msg: JsMsg): Promise<void> => {
    const streamName = msg.info.stream;
    const streamSequence = msg.info.streamSequence;
    const subject = msg.subject;

    logWithEnvelope(
      logger,
      null,
      "tracking.consume.received",
      `received subject=${subject} stream=${streamName} seq=${streamSequence}`
    );

    const { payload, decoded } = decodeBody(msg.data);

    // Stream name is forwarded so a DLQ-stream delivery short-circuits to rule 1
    // even when the subject alone does not reveal it (classify.ts / T04).
    const options: ClassifyOptions = { streamName };
    const result = processTrackedMessage(
      {
        subject,
        streamName,
        streamSequence,
        payload,
        decoded,
        receivedAt: now(),
      },
      options
    );

    metrics.recordProcessed(result.outcome);
    logOutcome(logger, metrics, subject, result);

    try {
      await deps.buffer.enqueue(result.row);
    } catch (error) {
      metrics.recordInsertFailure();
      logWithEnvelope(
        logger,
        rowLogContext(result.row),
        "tracking.consume.insert_failed",
        `insert failed subject=${subject}: ${errorMessage(error)} — nak`,
        "error"
      );
      msg.nak();
      return;
    }

    if (result.outcome === "malformed") {
      // Term (not ack): the body is drift and is already persisted for the
      // unknown alarm; redelivering it would only loop (TAXONOMY.md §3).
      logWithEnvelope(
        logger,
        rowLogContext(result.row),
        "tracking.consume.term",
        `terminated malformed subject=${subject} event_id=${result.row.event_id} after persist`,
        "warn"
      );
      msg.term();
      return;
    }

    logWithEnvelope(
      logger,
      rowLogContext(result.row),
      "tracking.consume.ack",
      `ack event_id=${result.row.event_id} outcome=${result.outcome}`
    );
    msg.ack();
  };
}

/** Decodes the NATS payload bytes to JSON; falls back to raw text on failure. */
function decodeBody(data: Uint8Array): { payload: unknown; decoded: boolean } {
  const text = new TextDecoder().decode(data);
  try {
    return { payload: JSON.parse(text), decoded: true };
  } catch {
    return { payload: text, decoded: false };
  }
}

/** Emits the per-outcome stage log and fires the unknown alarm when relevant. */
function logOutcome(
  logger: TrackedEventLogger,
  metrics: ITrackingIngesterMetricsSink,
  subject: string,
  result: ProcessResult
): void {
  const ctx = rowLogContext(result.row);
  const { row, outcome } = result;
  switch (outcome) {
    case "canonical":
      logWithEnvelope(
        logger,
        ctx,
        "tracking.consume.classified",
        `classified rule=${row.rule} tech=${row.tech} business_fn=${row.business_fn}`
      );
      return;
    case "non_envelope":
      // Rules 1/12/13/14/15 — tracked, NOT an alarm (to-tracked-event-row.ts).
      logWithEnvelope(
        logger,
        ctx,
        "tracking.consume.non_envelope",
        `tracked non-envelope family rule=${row.rule} tech=${row.tech} event_id=${row.event_id}`
      );
      return;
    case "unknown":
      // Rules 16/17/18 — unrecognized traffic = alarm (TAXONOMY.md §3).
      metrics.recordUnknown("classification");
      logWithEnvelope(
        logger,
        ctx,
        "tracking.consume.unknown",
        `UNKNOWN classification rule=${row.rule} subject=${subject} — alarm`,
        "error"
      );
      return;
    case "malformed":
      // Drift persisted as rule 18 unknown so the alarm surfaces it.
      metrics.recordUnknown("malformed");
      logWithEnvelope(
        logger,
        ctx,
        "tracking.consume.malformed",
        `malformed envelope drift subject=${subject} — alarm, persisting as unknown`,
        "error"
      );
      return;
  }
}

/** Minimal envelope-log context derived from the row (structured logging). */
function rowLogContext(row: TrackedEventRow): {
  id: string;
  tenant?: string;
  correlation_id?: string;
  causation_id?: string | null;
  producer?: string;
  domain?: string;
} {
  return {
    id: row.event_id,
    ...(row.tenant !== null && { tenant: row.tenant }),
    ...(row.correlation_id !== null && { correlation_id: row.correlation_id }),
    causation_id: row.causation_id,
    producer: row.producer,
    domain: row.domain,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Orchestrator (I/O edge) — one durable consumer group per stream source.
// ---------------------------------------------------------------------------

/**
 * Declarative spec for one durable consumer group. Field semantics mirror
 * `@yoizen/database`'s `IMultiTenantConsumerConfig` (the reuse authority);
 * `handler` is the shared per-message handler.
 */
export interface TrackedConsumerSpec {
  readonly streamPattern: RegExp;
  readonly durableName: string;
  readonly description: string;
  readonly maxAckPending: number;
  /** DLQ is DISABLED for the tracking ingester's own consumers. */
  readonly dlq: { readonly enabled: false };
  readonly handler: (msg: JsMsg) => Promise<void>;
}

/** Lifecycle handle returned by `createManager` (a `MultiTenantConsumerManager`). */
export interface TrackedConsumerManager {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ConsumeEventsDeps {
  /** Builds a durable consumer manager from a spec (injects the real manager). */
  readonly createManager: (spec: TrackedConsumerSpec) => TrackedConsumerManager;
  /** Shared per-message handler (from `makeTrackedEventHandler`). */
  readonly handler: (msg: JsMsg) => Promise<void>;
  /** @default DEFAULT_MAX_ACK_PENDING */
  readonly maxAckPending?: number;
}

/** The three consumer specs, in the order they are started. */
export function buildConsumerSpecs(
  handler: (msg: JsMsg) => Promise<void>,
  maxAckPending: number = DEFAULT_MAX_ACK_PENDING
): TrackedConsumerSpec[] {
  return [
    {
      streamPattern: INGRESS_STREAM_PATTERN,
      durableName: TRK_INGRESS_DURABLE,
      description: "tracking-ingester ingress consumer",
      maxAckPending,
      dlq: { enabled: false },
      handler,
    },
    {
      streamPattern: GATEWAY_AUDIT_STREAM_PATTERN,
      durableName: TRK_GATEWAY_AUDIT_DURABLE,
      description: "tracking-ingester gateway-audit consumer",
      maxAckPending,
      dlq: { enabled: false },
      handler,
    },
    {
      streamPattern: DLQ_STREAM_PATTERN,
      durableName: TRK_DLQ_DURABLE,
      description: "tracking-ingester dlq consumer",
      maxAckPending,
      dlq: { enabled: false },
      handler,
    },
  ];
}

/**
 * Starts every durable consumer group and returns a `stop` handle. Each manager
 * reconciles its matching tenant streams on its own (see
 * `MultiTenantConsumerManager`). Purely an I/O edge — all construction is
 * injected via `createManager`.
 */
export async function consumeEvents(
  deps: ConsumeEventsDeps
): Promise<{ stop(): Promise<void> }> {
  const specs = buildConsumerSpecs(
    deps.handler,
    deps.maxAckPending ?? DEFAULT_MAX_ACK_PENDING
  );
  const managers = specs.map((spec) => deps.createManager(spec));
  await Promise.all(managers.map((m) => m.start()));

  return {
    async stop(): Promise<void> {
      await Promise.all(managers.map((m) => m.stop()));
    },
  };
}
