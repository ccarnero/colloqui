// Regression coverage for the trace-visualization defect fix: real data has
// non-UUID correlation_ids (e.g. "memory:057092b6-9699-4dc6-96db-13eeec1d8167",
// "gateway_audit:58076") that derive non-hex trace_id/span_id values. Exporting
// such a span makes the otel-collector reject the WHOLE OTLP batch item with
// `400 readSpan.traceId: parse trace_id: invalid length` — one bad span must
// not take down the rest of the batch.

import { describe, expect, it } from "bun:test";
import { filterExportableSpans } from "../src/lib/filter-exportable-spans.js";
import type { OtelSpan } from "../src/lib/to-otel-span.js";

function span(overrides: Partial<OtelSpan> = {}): OtelSpan {
  return {
    trace_id: "11111111111111111111111111111111".slice(0, 32),
    span_id: "aaaaaaaaaaaaaaaa",
    service_name: "channel-service",
    name: "telegram.ingress",
    start_time_unix_nano: "1000000000",
    end_time_unix_nano: "1000000000",
    duration_ms: 0,
    attributes: {
      tech: "telegram",
      business_fn: "ingress",
      is_claim_check: false,
      compliance: "full",
      tenant: "acme",
    },
    ...overrides,
  };
}

describe("filterExportableSpans", () => {
  it("keeps a span with valid trace_id/span_id/parent_span_id", () => {
    const valid = span({ parent_span_id: "bbbbbbbbbbbbbbbb" });
    const logs: string[] = [];
    const result = filterExportableSpans([valid], (m) => logs.push(m));
    expect(result.valid).toEqual([valid]);
    expect(result.skipped).toBe(0);
    expect(logs).toEqual([]);
  });

  it("skips a span whose trace_id is derived from a non-UUID correlation_id (memory: family)", () => {
    const bad = span({
      trace_id: "memory057092b696994dc696db13eeec1d8167",
    });
    const logs: string[] = [];
    const result = filterExportableSpans([bad], (m) => logs.push(m));
    expect(result.valid).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(
      logs.some(
        (l) =>
          l.includes("memory057092b696994dc696db13eeec1d8167") &&
          l.includes("skipping")
      )
    ).toBe(true);
    expect(logs.some((l) => l.includes("skipped 1"))).toBe(true);
  });

  it("skips a span whose trace_id is derived from a non-UUID correlation_id (gateway_audit: family)", () => {
    const bad = span({ trace_id: "gatewayaudit58076" });
    const result = filterExportableSpans([bad], () => {});
    expect(result.valid).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("skips a span whose span_id is non-hex (synthesized non-envelope event_id)", () => {
    const bad = span({ span_id: "gateway_audit:41" });
    const result = filterExportableSpans([bad], () => {});
    expect(result.valid).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("skips a span whose parent_span_id is non-hex", () => {
    const bad = span({ parent_span_id: "gateway_audit:41" });
    const result = filterExportableSpans([bad], () => {});
    expect(result.valid).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("keeps other spans in the same batch when one is skipped", () => {
    const good = span();
    const bad = span({ trace_id: "gatewayaudit58076" });
    const result = filterExportableSpans([good, bad], () => {});
    expect(result.valid).toEqual([good]);
    expect(result.skipped).toBe(1);
  });

  it("returns skipped=0 and logs nothing for an all-valid batch", () => {
    const logs: string[] = [];
    const result = filterExportableSpans([span(), span()], (m) => logs.push(m));
    expect(result.skipped).toBe(0);
    expect(logs).toEqual([]);
  });
});
