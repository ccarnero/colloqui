import { describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackedEventSpan,
  ITrackingChainResponse,
} from "../../../../../core/services/tracking-chain.service";
import { computeStepLogEntries } from "../step-log-geometry";

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
    business_fn: "channel-processing",
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

describe("computeStepLogEntries", () => {
  it("orders entries chronologically by startMs, even when the chain's array order is out of order", () => {
    const first = event({
      event_id: "evt-first",
      kind: "trigger.matched",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const second = event({
      event_id: "evt-second",
      kind: "router.evaluate",
      occurred_at: "2026-01-01T00:00:00.100Z",
    });
    const third = event({
      event_id: "evt-third",
      kind: "agent.invoke",
      occurred_at: "2026-01-01T00:00:00.900Z",
    });

    // Array order deliberately reversed vs. occurred_at order.
    const chain: ITrackingChainResponse = {
      correlation_id: "corr-1",
      tenant: "acme",
      events: [third, first, second],
      spans: [span({})],
      summary: {
        count: 3,
        first_at: "2026-01-01T00:00:00.000Z",
        last_at: "2026-01-01T00:00:00.900Z",
        total_ms: 900,
        orphan_count: 0,
      },
    };

    const entries = computeStepLogEntries(chain);

    expect(entries.map((e) => e.eventId)).toEqual([
      "evt-first",
      "evt-second",
      "evt-third",
    ]);
  });

  it("carries the label/service/duration fields the waterfall's own row-matching already derives", () => {
    const runEvent = event({
      event_id: "evt-run",
      kind: "action_started",
      payload_action_name: "getPost",
      producer: "workflow-service",
      run_id: "run-1",
    });
    const chain: ITrackingChainResponse = {
      correlation_id: "corr-1",
      tenant: "acme",
      events: [runEvent],
      spans: [
        span({ kind_prefix: "action", entity_id: "run-1", duration_ms: 250 }),
      ],
      summary: {
        count: 1,
        first_at: "2026-01-01T00:00:00.000Z",
        last_at: "2026-01-01T00:00:00.250Z",
        total_ms: 250,
        orphan_count: 0,
      },
    };

    const [entry] = computeStepLogEntries(chain);

    expect(entry).toEqual({
      eventId: "evt-run",
      label: "getPost",
      service: "workflow-service",
      startMs: 0,
      durationMs: 250,
    });
  });

  it("returns an empty list for a chain with no events", () => {
    const chain: ITrackingChainResponse = {
      correlation_id: "corr-1",
      tenant: "acme",
      events: [],
      spans: [],
      summary: {
        count: 0,
        first_at: null,
        last_at: null,
        total_ms: 0,
        orphan_count: 0,
      },
    };

    expect(computeStepLogEntries(chain)).toEqual([]);
  });
});
