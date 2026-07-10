import { describe, expect, it } from "bun:test";
import { toSpanSourceRow } from "../src/lib/to-span-source-row.js";
import type { TrackedEventRow } from "../src/lib/to-tracked-event-row.js";

function sampleRow(overrides: Partial<TrackedEventRow> = {}): TrackedEventRow {
  return {
    event_id: "evt-1",
    subject:
      "evt.tenant-a.channel-service.messaging.telegram.telegram.received.v1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: "cause-1",
    causation_depth: 1,
    occurred_at: "2026-07-10T00:00:00.000Z",
    tech: "telegram",
    business_fn: "channel-processing",
    rule: 3,
    consumed_by: ["workflow-service"],
    is_claim_check: false,
    envelope: {},
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    ...overrides,
  };
}

describe("toSpanSourceRow", () => {
  it("maps a row to a zero-duration span source with matching start/end", () => {
    const row = sampleRow();
    const span = toSpanSourceRow(row);
    expect(span.event_id).toBe(row.event_id);
    expect(span.correlation_id).toBe(row.correlation_id);
    expect(span.causation_id).toBe(row.causation_id);
    expect(span.start_time).toBe(row.occurred_at);
    expect(span.end_time).toBe(row.occurred_at);
    expect(span.duration_ms).toBe(0);
    expect(span.service_name).toBe(row.producer);
    expect(span.tech).toBe(row.tech);
    expect(span.business_fn).toBe(row.business_fn);
    expect(span.is_claim_check).toBe(row.is_claim_check);
    expect(span.compliance).toBe(row.compliance);
    expect(span.tenant).toBe(row.tenant);
  });

  it("falls back to event_id as trace correlation when correlation_id is null (non-envelope rows)", () => {
    const row = sampleRow({ correlation_id: null, tenant: null });
    const span = toSpanSourceRow(row);
    expect(span.correlation_id).toBe(row.event_id);
    expect(span.tenant).toBeNull();
  });
});
