// Pure mapper — projects one row of the `tracking.tracked_event_spans` SQL view
// (see `src/sql/span-pairs.sql`) onto an OTLP span object. The view already did
// the pairing (`*_started`/`*_completed` → one row with `duration_ms`; unpaired
// point events → a zero-duration row), so this module derives NOTHING about
// causality or duration — it only shapes OTLP identifiers and attributes.
//
// ID derivation (SPEC per tasks.md T1):
//   - trace_id        = correlation_id UUID, dashes stripped, lowercased (32 hex chars)
//   - span_id         = first 16 hex chars of event_id UUID, dashes stripped, lowercased
//   - parent_span_id  = same derivation over causation_id; ABSENT (undefined) when
//                        causation_id is null — never dropped, never faked.
//
// A null causation_id is a documented, expected shape (root spans, and drift
// rows where causation was never recorded) — the span still emits, tagged with
// `causation_missing: true` so the gap is visible in Grafana instead of silently
// rendering as a root.

import type { Compliance } from "./to-tracked-event-row.js";

/**
 * One row of the `tracking.tracked_event_spans` view: an already-paired span
 * source (start + optional matching end), or a zero-duration point event.
 */
export interface SpanSourceRow {
  /** event_id of the span_start row (or the point event itself). */
  readonly event_id: string;
  readonly correlation_id: string;
  /** null for root spans and drift rows with no recorded causation. */
  readonly causation_id: string | null;
  /** ISO-8601 timestamp of the span's start (span_start.occurred_at). */
  readonly start_time: string;
  /** ISO-8601 timestamp of the span's end (span_end.occurred_at, or = start_time). */
  readonly end_time: string;
  /** end_time - start_time in milliseconds; 0 for point/unpaired events. */
  readonly duration_ms: number;
  /** Emitting service — becomes OTLP `service.name`. */
  readonly service_name: string;
  readonly tech: string;
  readonly business_fn: string;
  readonly is_claim_check: boolean;
  readonly compliance: Compliance;
  /** null for cross-tenant families (e.g. gateway-audit). */
  readonly tenant: string | null;
}

/** Minimal OTLP-shaped span attribute bag this mapper populates. */
export interface OtelSpanAttributes {
  tech: string;
  business_fn: string;
  is_claim_check: boolean;
  compliance: Compliance;
  tenant: string | null;
  /** Set to `true` ONLY when causation_id is null — surfaces the drift, never hidden. */
  causation_missing?: true;
}

/** Intermediate OTLP span object — T2's exporter groups these by service_name into resourceSpans. */
export interface OtelSpan {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  service_name: string;
  name: string;
  start_time_unix_nano: string;
  end_time_unix_nano: string;
  /** Convenience mirror of end - start in ms (also derivable from the nanos). */
  duration_ms: number;
  attributes: OtelSpanAttributes;
}

/** Strips dashes and lowercases a UUID-shaped string — the shared hex derivation. */
function toHex(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** trace_id: correlation_id UUID without dashes (32 hex chars). */
export function toTraceId(correlationId: string): string {
  return toHex(correlationId);
}

/** span_id / parent_span_id: first 16 hex chars of a UUID without dashes. */
export function toSpanId(eventOrCausationId: string): string {
  return toHex(eventOrCausationId).slice(0, 16);
}

function toUnixNano(isoTime: string): string {
  const millis = Date.parse(isoTime);
  return (BigInt(millis) * 1_000_000n).toString();
}

/**
 * Maps a paired/point span row to an OTLP span object.
 *
 * Never throws: `causation_id === null` is a valid, expected shape (root spans
 * and recorded drift), not an error — the span emits without a parent and is
 * flagged `causation_missing: true` instead of being dropped.
 */
export function toOtelSpan(row: SpanSourceRow): OtelSpan {
  const parentSpanId = row.causation_id
    ? toSpanId(row.causation_id)
    : undefined;

  return {
    trace_id: toTraceId(row.correlation_id),
    span_id: toSpanId(row.event_id),
    ...(parentSpanId ? { parent_span_id: parentSpanId } : {}),
    service_name: row.service_name,
    name: `${row.tech}.${row.business_fn}`,
    start_time_unix_nano: toUnixNano(row.start_time),
    end_time_unix_nano: toUnixNano(row.end_time),
    duration_ms: row.duration_ms,
    attributes: {
      tech: row.tech,
      business_fn: row.business_fn,
      is_claim_check: row.is_claim_check,
      compliance: row.compliance,
      tenant: row.tenant,
      ...(row.causation_id === null
        ? { causation_missing: true as const }
        : {}),
    },
  };
}
