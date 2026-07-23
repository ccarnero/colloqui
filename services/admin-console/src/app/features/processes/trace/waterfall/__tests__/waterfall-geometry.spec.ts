import { describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackedEventSpan,
  ITrackingChainResponse,
} from "../../../../../core/services/tracking-chain.service";
import {
  computeBottleneck,
  computeEventTimingPercent,
  computeWaterfallRows,
  eventEntityId,
  eventKindPrefix,
  matchEventSpans,
} from "../waterfall-geometry";

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

// Fixture chain: ingress point event -> channel point event -> a paired
// workflow execution span (started/completed, 800ms) -> the completed side
// (no span row, mirrors span-pairs.sql dropping the completed row entirely).
const evt1 = event({
  event_id: "evt-1",
  kind: "webhook_received",
  business_fn: "ingress",
  causation_depth: 0,
  occurred_at: "2026-01-01T00:00:00.000Z",
});
const evt2 = event({
  event_id: "evt-2",
  kind: "received",
  business_fn: "channel-processing",
  causation_depth: 1,
  causation_id: "evt-1",
  occurred_at: "2026-01-01T00:00:00.050Z",
});
const evt3 = event({
  event_id: "evt-3",
  kind: "execution_started",
  business_fn: "workflow-execution",
  causation_depth: 2,
  causation_id: "evt-2",
  run_id: "run-1",
  occurred_at: "2026-01-01T00:00:00.100Z",
});
const evt4 = event({
  event_id: "evt-4",
  kind: "execution_completed",
  business_fn: "workflow-execution",
  causation_depth: 2,
  causation_id: "evt-2",
  run_id: "run-1",
  occurred_at: "2026-01-01T00:00:00.900Z",
});

const spanIngress = span({ kind_prefix: "webhook_received", entity_id: null });
const spanChannel = span({ kind_prefix: "received", entity_id: null });
const spanExecution = span({
  kind_prefix: "execution",
  entity_id: "run-1",
  duration_ms: 800,
});

const chain: ITrackingChainResponse = {
  correlation_id: "corr-1",
  tenant: "acme",
  events: [evt1, evt2, evt3, evt4],
  spans: [spanIngress, spanChannel, spanExecution],
  summary: {
    count: 4,
    first_at: "2026-01-01T00:00:00.000Z",
    last_at: "2026-01-01T00:00:00.900Z",
    total_ms: 900,
    orphan_count: 0,
  },
};

describe("eventKindPrefix", () => {
  it("strips a trailing _started/_completed verb", () => {
    expect(eventKindPrefix(evt3)).toBe("execution");
    expect(eventKindPrefix(evt4)).toBe("execution");
  });

  it("passes through a kind with no verb suffix", () => {
    expect(eventKindPrefix(evt2)).toBe("received");
  });

  it("returns null when kind is null", () => {
    expect(eventKindPrefix(event({ kind: null }))).toBeNull();
  });
});

describe("eventEntityId", () => {
  it("prefers run_id, then workflow_id", () => {
    expect(eventEntityId(evt3)).toBe("run-1");
    expect(eventEntityId(event({ run_id: null, workflow_id: "wf-1" }))).toBe(
      "wf-1"
    );
    expect(eventEntityId(evt1)).toBeNull();
  });

  it("does NOT fall back to connector_id — it is not part of span-pairs.sql's pairing COALESCE (call_id is, but is not exposed on ITrackedEvent)", () => {
    expect(
      eventEntityId(
        event({ run_id: null, workflow_id: null, connector_id: "conn-1" })
      )
    ).toBeNull();
  });
});

describe("matchEventSpans", () => {
  it("matches each event to its kind_prefix/entity_id span, greedily consuming spans", () => {
    const result = matchEventSpans(chain.events, chain.spans);

    expect(result.get("evt-1")).toEqual(spanIngress);
    expect(result.get("evt-2")).toEqual(spanChannel);
    expect(result.get("evt-3")).toEqual(spanExecution);
    // The completed side of the pair has no span row left to consume —
    // mirrors span-pairs.sql dropping the completed row entirely.
    expect(result.get("evt-4")).toBeNull();
  });

  // Regression: connector-invocation events carry a `connector_id`
  // (adapter/endpoint id), not the `call_id` that span-pairs.sql actually
  // pairs on. `call_id` is never exposed on ITrackedEvent, so `eventEntityId`
  // returns null for these events, and matching must degrade to
  // kind_prefix-only (per matchEventSpans' null-entity-id branch) instead of
  // wrongly comparing `connector_id` against the span's `entity_id` (a
  // call_id it will essentially never equal — see waterfall-geometry.ts
  // eventEntityId doc comment).
  it("matches a connector-invocation event via kind_prefix-only fallback, even though the span's entity_id is a call_id unrelated to connector_id", () => {
    const connectorEvent = event({
      event_id: "evt-conn",
      kind: "endpoint_invoked",
      business_fn: "connector-invocation",
      connector_id: "connector-endpoint-1",
      run_id: null,
      workflow_id: null,
    });
    const connectorSpan = span({
      kind_prefix: "endpoint_invoked",
      entity_id: "call-abc-123",
      duration_ms: 120,
    });

    const result = matchEventSpans([connectorEvent], [connectorSpan]);

    expect(result.get("evt-conn")).toEqual(connectorSpan);
  });

  it("degrades to a null (point-row) match when no span shares the connector event's kind_prefix", () => {
    const connectorEvent = event({
      event_id: "evt-conn-2",
      kind: "endpoint_invoked",
      business_fn: "connector-invocation",
      connector_id: "connector-endpoint-1",
      run_id: null,
      workflow_id: null,
    });
    const unrelatedSpan = span({
      kind_prefix: "execution",
      entity_id: "call-xyz",
      duration_ms: 50,
    });

    const result = matchEventSpans([connectorEvent], [unrelatedSpan]);

    expect(result.get("evt-conn-2")).toBeNull();
  });
});

describe("computeWaterfallRows", () => {
  const rows = computeWaterfallRows(chain);

  it("produces one row per event, in chain order", () => {
    expect(rows.map((r) => r.eventId)).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
      "evt-4",
    ]);
  });

  it("indents by causation_depth", () => {
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2]);
  });

  it("renders unmatched/zero-duration events as point rows", () => {
    expect(rows[0]?.isPoint).toBe(true);
    expect(rows[0]?.durationMs).toBe(0);
    expect(rows[3]?.isPoint).toBe(true);
  });

  it("renders the matched span as a duration bar with correct geometry", () => {
    const bar = rows[2];
    expect(bar?.isPoint).toBe(false);
    expect(bar?.durationMs).toBe(800);
    expect(bar?.startMs).toBe(100);
    expect(bar?.startPercent).toBeCloseTo((100 / 900) * 100, 5);
    expect(bar?.widthPercent).toBeCloseTo((800 / 900) * 100, 5);
  });

  it("groups rows by business_fn", () => {
    expect(rows[0]?.group).toBe("channel"); // ingress
    expect(rows[1]?.group).toBe("channel"); // channel-processing
    expect(rows[2]?.group).toBe("platform"); // workflow-execution
  });

  it("labels action_started/action_completed rows with the action name instead of the generic kind", () => {
    const actionChain: ITrackingChainResponse = {
      ...chain,
      events: [
        event({
          event_id: "evt-action-start",
          kind: "action_started",
          payload_action_name: "getPost",
        }),
        event({
          event_id: "evt-action-complete",
          kind: "action_completed",
          payload_action_name: "getPost",
        }),
      ],
      spans: [],
    };
    const actionRows = computeWaterfallRows(actionChain);
    expect(actionRows[0]?.label).toBe("getPost");
    expect(actionRows[1]?.label).toBe("getPost");
  });

  it("falls back to the kind when an action event has no captured action name", () => {
    const noNameChain: ITrackingChainResponse = {
      ...chain,
      events: [
        event({
          event_id: "evt-action-noname",
          kind: "action_started",
          payload_action_name: null,
        }),
      ],
      spans: [],
    };
    const noNameRows = computeWaterfallRows(noNameChain);
    expect(noNameRows[0]?.label).toBe("action_started");
  });

  it("keeps the kind as the label for non-action events, even when payload_action_name is somehow set", () => {
    const nonActionChain: ITrackingChainResponse = {
      ...chain,
      events: [
        event({
          event_id: "evt-non-action",
          kind: "received",
          payload_action_name: "getPost",
        }),
      ],
      spans: [],
    };
    const nonActionRows = computeWaterfallRows(nonActionChain);
    expect(nonActionRows[0]?.label).toBe("received");
  });
});

describe("computeBottleneck", () => {
  it("returns the longest span and its share of the total duration", () => {
    const bottleneck = computeBottleneck(chain);
    expect(bottleneck).not.toBeNull();
    expect(bottleneck?.eventId).toBe("evt-3");
    expect(bottleneck?.durationMs).toBe(800);
    expect(bottleneck?.percentOfTotal).toBeCloseTo((800 / 900) * 100, 5);
  });

  it("returns null when every row is a zero-duration point event", () => {
    const pointOnlyChain: ITrackingChainResponse = {
      ...chain,
      events: [evt1, evt2],
      spans: [spanIngress, spanChannel],
      summary: { ...chain.summary, total_ms: 50 },
    };
    expect(computeBottleneck(pointOnlyChain)).toBeNull();
  });
});

describe("computeEventTimingPercent", () => {
  it("returns the event's share of the chain's total duration for a matched span (normal case)", () => {
    expect(computeEventTimingPercent(chain, "evt-3")).toBeCloseTo(
      (800 / 900) * 100,
      5
    );
  });

  it("returns null when the event has no matched span (missing timing)", () => {
    // evt-4 is the dropped completed-side row (matchEventSpans leaves it
    // unmatched — see the "matchEventSpans" describe block above).
    expect(computeEventTimingPercent(chain, "evt-4")).toBeNull();
  });

  it("returns null for an unknown event id", () => {
    expect(computeEventTimingPercent(chain, "evt-does-not-exist")).toBeNull();
  });

  it("does not divide by zero when the chain's total_ms is 0 (zero-total case) — falls back to the same 1ms floor computeWaterfallRows uses", () => {
    const zeroTotalChain: ITrackingChainResponse = {
      ...chain,
      summary: { ...chain.summary, total_ms: 0 },
    };
    const percent = computeEventTimingPercent(zeroTotalChain, "evt-3");
    expect(percent).not.toBeNull();
    expect(Number.isFinite(percent)).toBe(true);
  });
});
