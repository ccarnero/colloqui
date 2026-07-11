// Pure predicate — validates an OTLP `traceId`: exactly 32 lowercase hex
// chars, not all-zeros (the OTel spec reserves the all-zero trace_id as
// "invalid").
//
// `toTraceId` (to-otel-span.ts) derives trace_id from `correlation_id` by
// stripping dashes and lowercasing — it does NOT validate the input is a
// UUID. Real data carries non-UUID correlation_ids (e.g.
// "memory:057092b6-9699-4dc6-96db-13eeec1d8167",
// "gateway_audit:58076") whose dashes-stripped form is not 32 hex chars —
// exporting that value as `traceId` makes the otel-collector reject the
// WHOLE OTLP batch item with `400 readSpan.traceId: parse trace_id: invalid
// length`. This predicate lets the exporter (emit-otel-spans.ts, via
// filter-exportable-spans.ts) skip only the offending span instead.

const HEX_TRACE_ID_RE = /^[0-9a-f]{32}$/;
const ALL_ZERO_TRACE_ID = "0".repeat(32);

export function isValidTraceId(traceId: string): boolean {
  return HEX_TRACE_ID_RE.test(traceId) && traceId !== ALL_ZERO_TRACE_ID;
}
