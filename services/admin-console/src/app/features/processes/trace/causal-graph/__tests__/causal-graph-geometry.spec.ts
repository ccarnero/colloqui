import { describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackingChainResponse,
} from "../../../../../core/services/tracking-chain.service";
import {
  computeChainCompleteness,
  computeChannel,
  computeEdgePoints,
  computeGraphEdges,
  computeGraphNodes,
  DASHED_STUB_LENGTH,
} from "../causal-graph-geometry";

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
    ...overrides,
  };
}

function span(
  overrides: Partial<ITrackingChainResponse["spans"][number]>
): ITrackingChainResponse["spans"][number] {
  return {
    kind_prefix: "received",
    entity_id: null,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:00.000Z",
    duration_ms: 0,
    ...overrides,
  };
}

// evt-1 (ingress, root) -> evt-2, evt-3 (both causation_id=evt-1, branching) ->
// evt-4 declares a causation_id that is NOT present in the chain (solo
// correlation / orphan_count population).
const evt1 = event({
  event_id: "evt-1",
  kind: "webhook_received",
  business_fn: "ingress",
  tech: "telegram",
  causation_depth: 0,
  occurred_at: "2026-01-01T00:00:00.000Z",
});
const evt2 = event({
  event_id: "evt-2",
  kind: "execution_started",
  business_fn: "workflow-execution",
  causation_depth: 1,
  causation_id: "evt-1",
  occurred_at: "2026-01-01T00:00:00.100Z",
});
const evt3 = event({
  event_id: "evt-3",
  kind: "agent_invoked",
  business_fn: "agent-execution",
  causation_depth: 1,
  causation_id: "evt-1",
  occurred_at: "2026-01-01T00:00:00.150Z",
});
const evt4 = event({
  event_id: "evt-4",
  kind: "dlq_replayed",
  business_fn: "dlq",
  causation_depth: 2,
  causation_id: "evt-missing",
  tenant: null,
  compliance: "none",
  occurred_at: "2026-01-01T00:00:00.900Z",
});

const chain: ITrackingChainResponse = {
  correlation_id: "corr-1",
  tenant: "acme",
  events: [evt1, evt2, evt3, evt4],
  spans: [
    span({ kind_prefix: "webhook_received", duration_ms: 0 }),
    span({ kind_prefix: "execution", entity_id: "run-1", duration_ms: 250 }),
  ],
  summary: {
    count: 4,
    first_at: "2026-01-01T00:00:00.000Z",
    last_at: "2026-01-01T00:00:00.900Z",
    total_ms: 900,
    orphan_count: 1,
  },
};

describe("computeGraphNodes", () => {
  it("lays out one node per event, in chain order", () => {
    const nodes = computeGraphNodes(chain);
    expect(nodes.map((n) => n.eventId)).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
      "evt-4",
    ]);
  });

  it("uses causation_depth for the primary row", () => {
    const nodes = computeGraphNodes(chain);
    expect(nodes.map((n) => n.depth)).toEqual([0, 1, 1, 2]);
  });

  it("keeps the first child of a branching parent on column 0 and offsets the 2nd+ sibling to column 1", () => {
    const nodes = computeGraphNodes(chain);
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    expect(byId.get("evt-2")?.column).toBe(0);
    expect(byId.get("evt-3")?.column).toBe(1);
  });

  it("is deterministic — identical input produces identical coordinates", () => {
    const first = computeGraphNodes(chain);
    const second = computeGraphNodes(chain);
    expect(second).toEqual(first);
  });

  it("computes offsetMs relative to summary.first_at", () => {
    const nodes = computeGraphNodes(chain);
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    expect(byId.get("evt-2")?.offsetMs).toBe(100);
    expect(byId.get("evt-3")?.offsetMs).toBe(150);
  });
});

describe("computeGraphEdges", () => {
  const edges = computeGraphEdges(chain);

  it("produces a solid edge when the parent event is present in the chain", () => {
    const edge = edges.find((e) => e.toEventId === "evt-2");
    expect(edge).toEqual({
      id: "evt-1->evt-2",
      fromEventId: "evt-1",
      toEventId: "evt-2",
      dashed: false,
    });
  });

  it("produces a dashed edge when causation_id does not resolve within the chain (solo correlation)", () => {
    const edge = edges.find((e) => e.toEventId === "evt-4");
    expect(edge).toEqual({
      id: "evt-missing->evt-4",
      fromEventId: "evt-missing",
      toEventId: "evt-4",
      dashed: true,
    });
  });

  it("produces no edge for a true root event (causation_id is null)", () => {
    expect(edges.find((e) => e.toEventId === "evt-1")).toBeUndefined();
  });

  it("produces exactly one edge per non-root event", () => {
    expect(edges).toHaveLength(3);
  });
});

describe("computeEdgePoints", () => {
  const nodes = computeGraphNodes(chain);
  const byId = new Map(nodes.map((n) => [n.eventId, n]));
  const edges = computeGraphEdges(chain);

  it("connects parent and child node coordinates for a solid edge", () => {
    const edge = edges.find((e) => e.toEventId === "evt-2");
    const points = computeEdgePoints(edge!, byId);
    const parent = byId.get("evt-1")!;
    const child = byId.get("evt-2")!;
    expect(points).toEqual({
      x1: parent.x,
      y1: parent.y,
      x2: child.x,
      y2: child.y,
    });
  });

  it("draws a short vertical stub above the child node for a dashed edge (no parent coordinates exist)", () => {
    const edge = edges.find((e) => e.toEventId === "evt-4");
    const points = computeEdgePoints(edge!, byId);
    const child = byId.get("evt-4")!;
    expect(points).toEqual({
      x1: child.x,
      y1: child.y - DASHED_STUB_LENGTH,
      x2: child.x,
      y2: child.y,
    });
  });

  it("returns null when the edge's target node is not laid out", () => {
    const points = computeEdgePoints(
      {
        id: "x",
        fromEventId: "evt-1",
        toEventId: "evt-unknown",
        dashed: false,
      },
      byId
    );
    expect(points).toBeNull();
  });
});

describe("computeChannel", () => {
  it("returns the tech of the first ingress event", () => {
    expect(computeChannel(chain)).toBe("telegram");
  });

  it("falls back to the first event's tech when there is no ingress event", () => {
    const noIngress: ITrackingChainResponse = {
      ...chain,
      events: [evt2, evt3],
    };
    expect(computeChannel(noIngress)).toBe(evt2.tech);
  });

  it("returns unknown for an empty chain", () => {
    expect(computeChannel({ ...chain, events: [] })).toBe("unknown");
  });
});

describe("computeChainCompleteness", () => {
  it("counts spans with duration data as closed, against the event count", () => {
    expect(computeChainCompleteness(chain)).toEqual({ closed: 1, total: 4 });
  });
});
