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
    payload_action_name: null,
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

  it("uses structural tree depth (root=0, resolved children=parent+1); an unresolved causation_id makes a forest root at depth 0", () => {
    const nodes = computeGraphNodes(chain);
    // evt-1 root (0), evt-2/evt-3 its children (1); evt-4's causation_id
    // ("evt-missing") does not resolve in the chain, so it is a forest root
    // in its own right (depth 0), not depth 2.
    expect(nodes.map((n) => n.depth)).toEqual([0, 1, 1, 0]);
  });

  it("centers a branching parent's y over its children, ordered top-to-bottom by offsetMs", () => {
    const nodes = computeGraphNodes(chain);
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    const child1 = byId.get("evt-2")!; // offsetMs 100
    const child2 = byId.get("evt-3")!; // offsetMs 150
    const parent = byId.get("evt-1")!;
    expect(child1.y).toBeLessThan(child2.y);
    expect(parent.y).toBe((child1.y + child2.y) / 2);
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

describe("computeGraphNodes — tree layout properties", () => {
  it("centers a parent with 3 children between the topmost and bottommost child, with distinct increasing child y", () => {
    const root = event({
      event_id: "root",
      causation_id: null,
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const childA = event({
      event_id: "child-a",
      causation_id: "root",
      occurred_at: "2026-01-01T00:00:00.100Z",
    });
    const childB = event({
      event_id: "child-b",
      causation_id: "root",
      occurred_at: "2026-01-01T00:00:00.200Z",
    });
    const childC = event({
      event_id: "child-c",
      causation_id: "root",
      occurred_at: "2026-01-01T00:00:00.300Z",
    });
    const threeChildChain: ITrackingChainResponse = {
      ...chain,
      events: [root, childA, childB, childC],
    };

    const nodes = computeGraphNodes(threeChildChain);
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    const a = byId.get("child-a")!;
    const b = byId.get("child-b")!;
    const c = byId.get("child-c")!;
    const rootNode = byId.get("root")!;

    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    expect(rootNode.y).toBe((a.y + c.y) / 2);
  });

  it("computes depth as structural distance from the root through a 3-level chain, driving x rightward", () => {
    const grandparent = event({
      event_id: "gp",
      causation_id: null,
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const parent = event({
      event_id: "p",
      causation_id: "gp",
      occurred_at: "2026-01-01T00:00:00.100Z",
    });
    const grandchild = event({
      event_id: "gc",
      causation_id: "p",
      occurred_at: "2026-01-01T00:00:00.200Z",
    });
    const threeLevelChain: ITrackingChainResponse = {
      ...chain,
      events: [grandparent, parent, grandchild],
    };

    const nodes = computeGraphNodes(threeLevelChain);
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    const gp = byId.get("gp")!;
    const p = byId.get("p")!;
    const gc = byId.get("gc")!;
    expect(gp.depth).toBe(0);
    expect(p.depth).toBe(1);
    expect(gc.depth).toBe(2);
    // depth now drives x (left-to-right layout): root smallest x, and each
    // level advances by the same constant horizontal step (DEPTH_DX).
    expect(gp.x).toBeLessThan(p.x);
    expect(p.x).toBeLessThan(gc.x);
    expect(p.x - gp.x).toBe(gc.x - p.x);
  });

  it("orders children top-to-bottom by offsetMs even when declared out of chain order", () => {
    const root = event({
      event_id: "root",
      causation_id: null,
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    // Declared in chain order [late, early] — offsetMs must still win.
    const late = event({
      event_id: "late",
      causation_id: "root",
      occurred_at: "2026-01-01T00:00:00.500Z",
    });
    const early = event({
      event_id: "early",
      causation_id: "root",
      occurred_at: "2026-01-01T00:00:00.050Z",
    });
    const outOfOrderChain: ITrackingChainResponse = {
      ...chain,
      events: [root, late, early],
    };

    const nodes = computeGraphNodes(outOfOrderChain);
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    expect(byId.get("early")!.y).toBeLessThan(byId.get("late")!.y);
  });

  it("lays out a forest (two roots, or a root + an unresolved orphan) stacked vertically with non-overlapping y ranges", () => {
    const rootA = event({
      event_id: "root-a",
      causation_id: null,
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const childA1 = event({
      event_id: "root-a-child",
      causation_id: "root-a",
      occurred_at: "2026-01-01T00:00:00.100Z",
    });
    const rootB = event({
      event_id: "root-b",
      causation_id: "unresolved-parent", // orphan: does not resolve in chain
      occurred_at: "2026-01-01T00:00:00.200Z",
    });
    const forestChain: ITrackingChainResponse = {
      ...chain,
      events: [rootA, childA1, rootB],
    };

    const nodes = computeGraphNodes(forestChain);
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    const treeAYs = [byId.get("root-a")!.y, byId.get("root-a-child")!.y];
    const treeBY = byId.get("root-b")!.y;

    // Both roots sit at depth 0 (same x column) but stack vertically —
    // separate forest trees occupy non-overlapping y ranges.
    expect(Math.max(...treeAYs)).toBeLessThan(treeBY);
    expect(byId.get("root-a")?.x).toBe(byId.get("root-b")?.x);
    expect(byId.get("root-b")?.depth).toBe(0);
  });

  it("gives leaves at the same depth distinct y (no two nodes share x and y)", () => {
    const root = event({
      event_id: "root",
      causation_id: null,
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const childA = event({
      event_id: "child-a",
      causation_id: "root",
      occurred_at: "2026-01-01T00:00:00.100Z",
    });
    const childB = event({
      event_id: "child-b",
      causation_id: "root",
      occurred_at: "2026-01-01T00:00:00.200Z",
    });
    const siblingsChain: ITrackingChainResponse = {
      ...chain,
      events: [root, childA, childB],
    };

    const nodes = computeGraphNodes(siblingsChain);
    const seen = new Set<string>();
    for (const node of nodes) {
      const key = `${node.x},${node.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("computeGraphNodes — cycle safety (malformed causation_id)", () => {
  it("treats a self-loop (causation_id === event_id) as a forest root instead of infinite-recursing", () => {
    const selfLoop = event({
      event_id: "self-loop",
      causation_id: "self-loop",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const selfLoopChain: ITrackingChainResponse = {
      ...chain,
      events: [selfLoop],
    };

    const nodes = computeGraphNodes(selfLoopChain);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.eventId).toBe("self-loop");
    expect(node.depth).toBe(0);
    expect(Number.isFinite(node.x)).toBe(true);
    expect(Number.isFinite(node.y)).toBe(true);
  });

  it("demotes a 2-cycle (A causation_id=B, B causation_id=A) to two forest roots instead of throwing", () => {
    const a = event({
      event_id: "cycle-a",
      causation_id: "cycle-b",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const b = event({
      event_id: "cycle-b",
      causation_id: "cycle-a",
      occurred_at: "2026-01-01T00:00:00.100Z",
    });
    const cycleChain: ITrackingChainResponse = {
      ...chain,
      events: [a, b],
    };

    expect(() => computeGraphNodes(cycleChain)).not.toThrow();
    const nodes = computeGraphNodes(cycleChain);
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.depth).toBe(0);
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("guarantees exactly one node per input event, with finite x/y, on a mixed topology (normal tree + self-loop + 2-cycle)", () => {
    const root = event({
      event_id: "mixed-root",
      causation_id: null,
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    const child = event({
      event_id: "mixed-child",
      causation_id: "mixed-root",
      occurred_at: "2026-01-01T00:00:00.100Z",
    });
    const selfLoop = event({
      event_id: "mixed-self-loop",
      causation_id: "mixed-self-loop",
      occurred_at: "2026-01-01T00:00:00.200Z",
    });
    const cycleA = event({
      event_id: "mixed-cycle-a",
      causation_id: "mixed-cycle-b",
      occurred_at: "2026-01-01T00:00:00.300Z",
    });
    const cycleB = event({
      event_id: "mixed-cycle-b",
      causation_id: "mixed-cycle-a",
      occurred_at: "2026-01-01T00:00:00.400Z",
    });
    const mixedEvents = [root, child, selfLoop, cycleA, cycleB];
    const mixedChain: ITrackingChainResponse = {
      ...chain,
      events: mixedEvents,
    };

    const nodes = computeGraphNodes(mixedChain);
    expect(nodes).toHaveLength(mixedEvents.length);
    expect(new Set(nodes.map((n) => n.eventId)).size).toBe(mixedEvents.length);
    for (const node of nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    // The normal tree branch is unaffected by the malformed siblings.
    const byId = new Map(nodes.map((n) => [n.eventId, n]));
    expect(byId.get("mixed-root")?.depth).toBe(0);
    expect(byId.get("mixed-child")?.depth).toBe(1);
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

  it("draws a short horizontal stub to the left of the child node for a dashed edge (no parent coordinates exist)", () => {
    const edge = edges.find((e) => e.toEventId === "evt-4");
    const points = computeEdgePoints(edge!, byId);
    const child = byId.get("evt-4")!;
    expect(points).toEqual({
      x1: child.x - DASHED_STUB_LENGTH,
      y1: child.y,
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
