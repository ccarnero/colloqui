import { describe, expect, it } from "bun:test";
import type { ChainEventRow } from "../../src/lib/build-chain-query.js";
import type { ChainSpanRow } from "../../src/lib/build-spans-query.js";
import { toChainResponse } from "../../src/lib/to-chain-response.js";

function sampleEvent(overrides: Partial<ChainEventRow> = {}): ChainEventRow {
  return {
    event_id: "evt-1",
    subject: "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 0,
    occurred_at: "2026-07-11T12:00:00.000Z",
    tech: "whatsapp",
    business_fn: "messaging",
    rule: 3,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    ...overrides,
  };
}

function sampleSpan(overrides: Partial<ChainSpanRow> = {}): ChainSpanRow {
  return {
    event_id: "evt-span-1",
    causation_id: null,
    kind_prefix: "execution",
    entity_id: "run-1",
    started_at: "2026-07-11T12:00:00.000Z",
    completed_at: "2026-07-11T12:00:00.000Z",
    duration_ms: 0,
    ...overrides,
  };
}

describe("toChainResponse — shape", () => {
  it("carries correlation_id and tenant verbatim", () => {
    const response = toChainResponse("corr-1", "tenant-a", [], []);
    expect(response.correlation_id).toBe("corr-1");
    expect(response.tenant).toBe("tenant-a");
  });

  it("passes events and spans through unmodified", () => {
    const events = [sampleEvent()];
    const spans = [sampleSpan()];
    const response = toChainResponse("corr-1", "tenant-a", events, spans);
    expect(response.events).toBe(events);
    expect(response.spans).toBe(spans);
  });

  it("carries a null tenant verbatim", () => {
    const response = toChainResponse("corr-1", null, [], []);
    expect(response.tenant).toBeNull();
  });
});

describe("toChainResponse — summary: count / first_at / last_at / total_ms", () => {
  it("reports zeroed-out summary for an empty chain", () => {
    const response = toChainResponse("corr-1", "tenant-a", [], []);
    expect(response.summary).toEqual({
      count: 0,
      first_at: null,
      last_at: null,
      total_ms: 0,
      orphan_count: 0,
    });
  });

  it("computes count from the event list length", () => {
    const events = [
      sampleEvent({ event_id: "evt-1" }),
      sampleEvent({ event_id: "evt-2" }),
    ];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.summary.count).toBe(2);
  });

  it("derives first_at/last_at/total_ms from occurred_at, independent of input order", () => {
    const events = [
      sampleEvent({
        event_id: "evt-2",
        occurred_at: "2026-07-11T12:00:05.000Z",
      }),
      sampleEvent({
        event_id: "evt-1",
        occurred_at: "2026-07-11T12:00:00.000Z",
      }),
    ];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.summary.first_at).toBe("2026-07-11T12:00:00.000Z");
    expect(response.summary.last_at).toBe("2026-07-11T12:00:05.000Z");
    expect(response.summary.total_ms).toBe(5000);
  });

  it("yields total_ms 0 for a single-event chain", () => {
    const events = [sampleEvent()];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.summary.total_ms).toBe(0);
    expect(response.summary.first_at).toBe(response.summary.last_at);
  });
});

describe("toChainResponse — orphan_count", () => {
  it("counts events with a causation_id absent from the event set", () => {
    const events = [
      sampleEvent({ event_id: "evt-1", causation_id: null }),
      sampleEvent({ event_id: "evt-2", causation_id: "missing-parent" }),
    ];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.summary.orphan_count).toBe(1);
  });

  it("does not count events whose causation_id resolves within the set", () => {
    const events = [
      sampleEvent({ event_id: "evt-1", causation_id: null }),
      sampleEvent({ event_id: "evt-2", causation_id: "evt-1" }),
    ];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.summary.orphan_count).toBe(0);
  });

  it("does not count events with a null causation_id as orphans", () => {
    const events = [sampleEvent({ event_id: "evt-1", causation_id: null })];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.summary.orphan_count).toBe(0);
  });

  it("counts multiple orphans independently", () => {
    const events = [
      sampleEvent({ event_id: "evt-1", causation_id: "ghost-a" }),
      sampleEvent({ event_id: "evt-2", causation_id: "ghost-b" }),
      sampleEvent({ event_id: "evt-3", causation_id: "evt-1" }),
    ];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.summary.orphan_count).toBe(2);
  });
});

describe("toChainResponse — null-tenant flagging", () => {
  it("preserves null-tenant events in the response for the console to flag", () => {
    const events = [
      sampleEvent({ event_id: "evt-1", tenant: "tenant-a" }),
      sampleEvent({ event_id: "evt-2", tenant: null, has_envelope: false }),
    ];
    const response = toChainResponse("corr-1", "tenant-a", events, []);
    expect(response.events).toHaveLength(2);
    const nullTenantEvent = response.events.find((e) => e.tenant === null);
    expect(nullTenantEvent).toBeDefined();
    expect(nullTenantEvent?.has_envelope).toBe(false);
  });
});
