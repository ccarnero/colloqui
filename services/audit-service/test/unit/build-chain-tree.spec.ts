import { describe, it, expect } from "bun:test";
import {
  buildChainTree,
  MAX_CHAIN_NODES,
} from "../../src/modules/audit/build-chain-tree";
import type { IAuditEvent } from "../../src/modules/audit/audit.repository.interface";

/** Minimal IAuditEvent factory for tree tests. */
function makeEvent(
  overrides: Partial<IAuditEvent> & { id: string },
): IAuditEvent {
  return {
    type: "test.event",
    payload: {},
    metadata: {},
    subject: "evt.test",
    created_at: new Date().toISOString(),
    depth: 0,
    correlation_id: "corr-1",
    causation_id: null,
    ...overrides,
  };
}

describe("buildChainTree", () => {
  it("returns null for empty input", () => {
    const result = buildChainTree([], "corr-1");
    expect(result).toBeNull();
  });

  it("builds a linear chain A→B→C correctly", () => {
    const a = makeEvent({ id: "a", causation_id: null, depth: 0 });
    const b = makeEvent({ id: "b", causation_id: "a", depth: 1 });
    const c = makeEvent({ id: "c", causation_id: "b", depth: 2 });

    const result = buildChainTree([a, b, c], "corr-1");
    expect(result).not.toBeNull();
    expect(result!.root.id).toBe("a");
    expect(result!.root.children).toHaveLength(1);
    expect(result!.root.children[0]!.id).toBe("b");
    expect(result!.root.children[0]!.children).toHaveLength(1);
    expect(result!.root.children[0]!.children[0]!.id).toBe("c");
    expect(result!.node_count).toBe(3);
    expect(result!.max_depth).toBe(2);
    expect(result!.truncated).toBe(false);
    expect(result!.orphans).toHaveLength(0);
  });

  it("handles branching — one parent two children", () => {
    const root = makeEvent({ id: "root", causation_id: null, depth: 0 });
    const child1 = makeEvent({ id: "child1", causation_id: "root", depth: 1 });
    const child2 = makeEvent({ id: "child2", causation_id: "root", depth: 1 });

    const result = buildChainTree([root, child1, child2], "corr-1");
    expect(result!.root.children).toHaveLength(2);
    const childIds = result!.root.children.map((c) => c.id).sort();
    expect(childIds).toEqual(["child1", "child2"]);
  });

  it("missing root → synthetic_root: true, tree still returned", () => {
    // No null-causation node — all events are orphaned in a sense
    const b = makeEvent({ id: "b", causation_id: "a-missing", depth: 1 });
    const c = makeEvent({ id: "c", causation_id: "b", depth: 2 });

    const result = buildChainTree([b, c], "corr-1");
    expect(result).not.toBeNull();
    expect(result!.synthetic_root).toBe(true);
    expect(result!.root).toBeDefined();
  });

  it("orphan node (parent id absent) lands in orphans[], not dropped", () => {
    const root = makeEvent({ id: "root", causation_id: null, depth: 0 });
    const orphan = makeEvent({
      id: "orphan",
      causation_id: "ghost-id",
      depth: 1,
    });

    const result = buildChainTree([root, orphan], "corr-1");
    expect(result!.orphans).toHaveLength(1);
    expect(result!.orphans[0]!.id).toBe("orphan");
    // root should not have orphan as a child
    expect(result!.root.children).toHaveLength(0);
  });

  it("over-cap input → truncated: true, node_count == MAX_CHAIN_NODES", () => {
    const events: IAuditEvent[] = [
      makeEvent({ id: "root", causation_id: null, depth: 0 }),
    ];
    for (let i = 1; i <= MAX_CHAIN_NODES; i++) {
      events.push(
        makeEvent({ id: `node-${i}`, causation_id: "root", depth: 1 }),
      );
    }

    const result = buildChainTree(events, "corr-1");
    expect(result!.truncated).toBe(true);
    expect(result!.node_count).toBe(MAX_CHAIN_NODES);
  });

  it("cyclic input does not infinite-loop", () => {
    // a → b → a (cycle via causation_id)
    const a = makeEvent({ id: "a", causation_id: "b", depth: 0 });
    const b = makeEvent({ id: "b", causation_id: "a", depth: 1 });

    // Should complete without hanging
    const result = buildChainTree([a, b], "corr-1");
    expect(result).not.toBeNull();
  });

  it("multiple null-causation roots: first becomes root, rest in extra_roots", () => {
    const r1 = makeEvent({
      id: "r1",
      causation_id: null,
      depth: 0,
      created_at: "2024-01-01T00:00:00.000Z",
    });
    const r2 = makeEvent({
      id: "r2",
      causation_id: null,
      depth: 0,
      created_at: "2024-01-02T00:00:00.000Z",
    });

    const result = buildChainTree([r1, r2], "corr-1");
    expect(result!.root.id).toBe("r1");
    expect(result!.extra_roots).toHaveLength(1);
    expect(result!.extra_roots[0]!.id).toBe("r2");
  });
});
