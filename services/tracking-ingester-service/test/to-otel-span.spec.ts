// Unit tests for the pure span-row → OTLP-span mapper (T1 of
// .sdd/changes/trace-visualization/tasks.md).
//
// The input shape mirrors a row of the `tracking.tracked_event_spans` SQL view
// (T1's other deliverable): a span row is already PAIRED (start + optional end)
// by the view, so this mapper does no pairing of its own — it only derives OTLP
// identifiers and shapes the attributes.
//
// A hand-built "telegram chain" fixture stands in for a real ingested chain
// (fixtures/bus-events/ has no pre-built 11-event chain fixture): five rows
// covering ingress → workflow start/complete pair → agent step → egress, with
// causation_id chaining every non-root row to its parent event_id. This gives
// every acceptance case in tasks.md (root has no parent, non-root parent
// resolves, paired span duration, point-event zero duration, missing-causation
// span not dropped) without inventing a parallel fixture format.

import { describe, expect, it } from "bun:test";
import { toOtelSpan, toSpanId } from "../src/lib/to-otel-span.js";

describe("toOtelSpan — telegram chain fixture", () => {
  const correlationId = "11111111-1111-1111-1111-111111111111";

  const ingress = {
    event_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    correlation_id: correlationId,
    causation_id: null,
    start_time: "2026-07-10T00:00:00.000Z",
    end_time: "2026-07-10T00:00:00.000Z",
    duration_ms: 0,
    service_name: "channel-service",
    tech: "telegram" as const,
    business_fn: "ingress" as const,
    is_claim_check: false,
    compliance: "full" as const,
    tenant: "acme",
  };

  const workflowPair = {
    event_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    correlation_id: correlationId,
    causation_id: ingress.event_id,
    start_time: "2026-07-10T00:00:01.000Z",
    end_time: "2026-07-10T00:00:03.500Z",
    duration_ms: 2500,
    service_name: "workflow-service",
    tech: "workflow" as const,
    business_fn: "orchestration" as const,
    is_claim_check: false,
    compliance: "full" as const,
    tenant: "acme",
  };

  const pointEvent = {
    event_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    correlation_id: correlationId,
    causation_id: workflowPair.event_id,
    start_time: "2026-07-10T00:00:04.000Z",
    end_time: "2026-07-10T00:00:04.000Z",
    duration_ms: 0,
    service_name: "channel-service",
    tech: "telegram" as const,
    business_fn: "egress" as const,
    is_claim_check: false,
    compliance: "full" as const,
    tenant: "acme",
  };

  const droppedCausation = {
    event_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    correlation_id: correlationId,
    causation_id: null,
    start_time: "2026-07-10T00:00:05.000Z",
    end_time: "2026-07-10T00:00:05.000Z",
    duration_ms: 0,
    service_name: "usage-aggregator-service",
    tech: "usage" as const,
    business_fn: "aggregation" as const,
    is_claim_check: false,
    compliance: "full" as const,
    tenant: "acme",
  };

  it("root span (causation_id null) has no parent_span_id", () => {
    const span = toOtelSpan(ingress);
    expect(span.parent_span_id).toBeUndefined();
    expect(span.trace_id).toBe("11111111111111111111111111111111".slice(0, 32));
    expect(span.trace_id).toHaveLength(32);
    expect(span.span_id).toBe(toSpanId(ingress.event_id));
    expect(span.span_id).toHaveLength(16);
  });

  it("root span sets causation_missing=true", () => {
    const span = toOtelSpan(ingress);
    expect(span.attributes.causation_missing).toBe(true);
  });

  it("every non-root span's parent_span_id equals the span_id derived from its causation event", () => {
    const workflowSpan = toOtelSpan(workflowPair);
    expect(workflowSpan.parent_span_id).toBe(toSpanId(ingress.event_id));

    const pointSpan = toOtelSpan(pointEvent);
    expect(pointSpan.parent_span_id).toBe(toSpanId(workflowPair.event_id));
  });

  it("non-root span does NOT set causation_missing", () => {
    const span = toOtelSpan(workflowPair);
    expect(span.attributes.causation_missing).toBeUndefined();
  });

  it("workflow started/completed pair yields a single span with duration_ms = ts_completed - ts_started", () => {
    const span = toOtelSpan(workflowPair);
    expect(span.duration_ms).toBe(2500);
    const startNanos = BigInt(span.start_time_unix_nano);
    const endNanos = BigInt(span.end_time_unix_nano);
    expect(Number((endNanos - startNanos) / 1_000_000n)).toBe(2500);
  });

  it("a point event (e.g. sent) yields a zero-duration span", () => {
    const span = toOtelSpan(pointEvent);
    expect(span.duration_ms).toBe(0);
    expect(span.start_time_unix_nano).toBe(span.end_time_unix_nano);
  });

  it("an event with causation_id null is emitted WITHOUT a parent, never dropped", () => {
    const span = toOtelSpan(droppedCausation);
    expect(span).toBeDefined();
    expect(span.parent_span_id).toBeUndefined();
    expect(span.attributes.causation_missing).toBe(true);
  });

  it("sets service.name, tech, business_fn, is_claim_check, compliance, tenant attributes", () => {
    const span = toOtelSpan(workflowPair);
    expect(span.service_name).toBe("workflow-service");
    expect(span.attributes.tech).toBe("workflow");
    expect(span.attributes.business_fn).toBe("orchestration");
    expect(span.attributes.is_claim_check).toBe(false);
    expect(span.attributes.compliance).toBe("full");
    expect(span.attributes.tenant).toBe("acme");
  });

  it("handles a null tenant without throwing (cross-tenant families)", () => {
    const span = toOtelSpan({ ...ingress, tenant: null });
    expect(span.attributes.tenant).toBeNull();
  });
});

describe("toSpanId", () => {
  it("derives 16 lowercase hex chars from a UUID, dashes stripped", () => {
    const id = toSpanId("AAAAAAAA-bbbb-CCCC-dddd-eeeeeeeeeeee");
    expect(id).toBe("aaaaaaaabbbbcccc");
    expect(id).toHaveLength(16);
  });
});
