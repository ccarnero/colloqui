// Exporter guard (defect fix for trace-visualization) — drops spans whose
// derived trace_id/span_id/parent_span_id are not valid OTLP hex ids BEFORE
// they reach the collector.
//
// Real data carries non-UUID correlation_ids/event_ids (e.g.
// "memory:057092b6-9699-4dc6-96db-13eeec1d8167", "gateway_audit:58076" —
// GATEWAY_AUDIT rows synthesize `event_id` as "<stream>:<seq>", see
// to-tracked-event-row.ts). `toOtelSpan` (to-otel-span.ts) derives ids by
// stripping dashes and lowercasing WITHOUT validating UUID shape, so such
// rows produce non-hex `traceId`/`spanId` values. The otel-collector rejects
// the WHOLE OTLP batch item with `400 readSpan.traceId: parse trace_id:
// invalid length` for even one bad span — this filter keeps the rest of the
// batch exportable by skipping only the offending span(s), logged verbosely
// so the gap is visible instead of silently dropped.

import { isValidSpanId } from "./is-valid-span-id.js";
import { isValidTraceId } from "./is-valid-trace-id.js";
import type { OtelSpan } from "./to-otel-span.js";

export interface FilterExportableSpansResult {
  readonly valid: OtelSpan[];
  readonly skipped: number;
}

function isExportable(span: OtelSpan): boolean {
  if (!isValidTraceId(span.trace_id)) {
    return false;
  }
  if (!isValidSpanId(span.span_id)) {
    return false;
  }
  if (
    span.parent_span_id !== undefined &&
    !isValidSpanId(span.parent_span_id)
  ) {
    return false;
  }
  return true;
}

/**
 * Splits `spans` into exportable vs. non-UUID-derived ids to skip.
 *
 * @param spans batch produced by `toOtelSpan` (may include non-hex ids).
 * @param log verbose line logger — one line per skipped span, plus a batch
 *   summary line (`"skipped N non-UUID-correlation spans"`) when N > 0.
 */
export function filterExportableSpans(
  spans: readonly OtelSpan[],
  log: (message: string) => void
): FilterExportableSpansResult {
  const valid: OtelSpan[] = [];
  let skipped = 0;

  for (const span of spans) {
    if (isExportable(span)) {
      valid.push(span);
      continue;
    }

    skipped += 1;
    const parentPart =
      span.parent_span_id !== undefined
        ? ` parent_span_id=${span.parent_span_id}`
        : "";
    log(
      `filterExportableSpans: skipping span with non-UUID-derived id — trace_id=${span.trace_id} span_id=${span.span_id}${parentPart}`
    );
  }

  if (skipped > 0) {
    log(
      `filterExportableSpans: skipped ${skipped} non-UUID-correlation span(s)`
    );
  }

  return { valid, skipped };
}
