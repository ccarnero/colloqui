// Pure predicate — validates an OTLP `spanId`/`parentSpanId`: exactly 16
// lowercase hex chars, not all-zeros (the OTel spec reserves the all-zero
// span_id as "invalid").
//
// `toSpanId` (to-otel-span.ts) derives span_id/parent_span_id from
// `event_id`/`causation_id` by stripping dashes and lowercasing — it does
// NOT validate the input is a UUID. `event_id` is NOT guaranteed to be a
// UUID: non-envelope rows (T07, TAXONOMY.md §4 rules 1/12/13/14/15/18)
// synthesize `event_id` as `"<stream>:<seq>"` (e.g. "GATEWAY_AUDIT:41771",
// see to-tracked-event-row.ts), whose dashes-stripped form is not 16 hex
// chars. Exporting that value as `spanId`/`parentSpanId` makes the
// otel-collector reject the WHOLE OTLP batch item. This predicate lets the
// exporter (emit-otel-spans.ts, via filter-exportable-spans.ts) skip only
// the offending span instead.

const HEX_SPAN_ID_RE = /^[0-9a-f]{16}$/;
const ALL_ZERO_SPAN_ID = "0".repeat(16);

export function isValidSpanId(spanId: string): boolean {
  return HEX_SPAN_ID_RE.test(spanId) && spanId !== ALL_ZERO_SPAN_ID;
}
