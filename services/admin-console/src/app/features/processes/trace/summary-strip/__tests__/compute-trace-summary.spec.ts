import { describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackedEventSpan,
  ITrackingChainResponse,
} from "../../../../../core/services/tracking-chain.service";
import { computeTraceSummary } from "../compute-trace-summary";

function event(overrides: Partial<ITrackedEvent>): ITrackedEvent {
  return {
    event_id: "evt-x",
    subject: "evt.acme.channel-service.messaging.telegram.telegram.received.v1",
    tenant: "acme",
    producer: "channel-service",
    domain: "channel",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 0,
    occurred_at: "2026-01-01T00:00:00.000Z",
    tech: "telegram",
    business_fn: "ingress",
    rule: 3,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    payload_action_name: null,
    ...overrides,
  };
}

function span(overrides: Partial<ITrackedEventSpan>): ITrackedEventSpan {
  return {
    kind_prefix: "received",
    entity_id: null,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:00.000Z",
    duration_ms: 0,
    ...overrides,
  };
}

describe("computeTraceSummary", () => {
  it("assembles all 5 summary-strip cells from the loaded chain, reusing the existing per-tab derivations", () => {
    const evt1 = event({
      event_id: "e1",
      kind: "received",
      tech: "telegram",
      business_fn: "ingress",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const evt2 = event({
      event_id: "e2",
      kind: "send",
      business_fn: "egress",
      occurred_at: "2026-01-01T00:00:00.500Z",
    });
    const evt3 = event({
      event_id: "e3",
      kind: "sent",
      business_fn: "egress",
      occurred_at: "2026-01-01T00:00:01.000Z",
    });

    const chain: ITrackingChainResponse = {
      correlation_id: "corr-1",
      tenant: "acme",
      events: [evt1, evt2, evt3],
      spans: [span({ kind_prefix: "received", duration_ms: 250 })],
      summary: {
        count: 3,
        first_at: evt1.occurred_at,
        last_at: evt3.occurred_at,
        total_ms: 1000,
        orphan_count: 0,
      },
    };

    const summary = computeTraceSummary(chain);

    expect(summary.verdict).toBe("replied");
    expect(summary.totalMs).toBe(1000);
    expect(summary.eventsCount).toBe(3);
    expect(summary.spansClosed).toBe(1);
    expect(summary.spansTotal).toBe(3);
    expect(summary.channel).toBe("telegram");
    expect(summary.bottleneck).not.toBeNull();
  });

  it("returns a null bottleneck and null verdict when the chain has no durations or delivery kinds", () => {
    const evt1 = event({
      event_id: "e1",
      kind: "execution_started",
      business_fn: "workflow",
      tech: "http-generic",
    });
    const chain: ITrackingChainResponse = {
      correlation_id: "corr-2",
      tenant: null,
      events: [evt1],
      spans: [],
      summary: {
        count: 1,
        first_at: evt1.occurred_at,
        last_at: evt1.occurred_at,
        total_ms: 0,
        orphan_count: 0,
      },
    };

    const summary = computeTraceSummary(chain);

    expect(summary.verdict).toBeNull();
    expect(summary.bottleneck).toBeNull();
    expect(summary.channel).toBe("http-generic");
  });
});
