import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { findCycle } from "../../../src/modules/plan/lib/find-cycle";

describe("findCycle", () => {
  it("returns null for an acyclic graph", () => {
    const graph = new Map<string, string[]>([
      ["channel:support-telegram", []],
      ["connector:hubspot", []],
      ["agent:support-agent", []],
      ["service:priority-scorer", []],
      [
        "workflow:ticket-router",
        [
          "channel:support-telegram",
          "agent:support-agent",
          "service:priority-scorer",
        ],
      ],
    ]);

    expect(findCycle(graph)).toBeNull();
  });

  it("returns null for an empty graph", () => {
    expect(findCycle(new Map())).toBeNull();
  });

  it("detects a direct 2-node cycle", () => {
    const graph = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);

    const cycle = findCycle(graph);
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.at(-1));
  });

  it("detects the SPEC's illustrative 'workflow -> service -> workflow' cycle shape", () => {
    // The current (human-approved) T01 manifest schema has no `workflowRef`
    // symbolic-ref type, so a schema-valid manifest cannot actually
    // construct this exact cycle end-to-end (see comment in
    // `find-cycle.ts`). This test verifies the cycle-detection ALGORITHM
    // directly against a hand-built graph shaped exactly like the SPEC's
    // example, independent of whether today's manifest schema can produce it.
    const graph = new Map<string, string[]>([
      ["workflow:wf-a", ["service:svc-a"]],
      ["service:svc-a", ["workflow:wf-a"]],
    ]);

    const cycle = findCycle(graph);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("workflow:wf-a");
    expect(cycle).toContain("service:svc-a");
  });

  it("detects a longer indirect cycle (a -> b -> c -> a)", () => {
    const graph = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a"]],
      ["d", []], // unrelated acyclic node must not confuse detection
    ]);

    const cycle = findCycle(graph);
    expect(cycle).not.toBeNull();
    expect(cycle?.length).toBeGreaterThanOrEqual(3);
  });

  it("terminates (does not hang) on a graph with many disconnected acyclic components", () => {
    const graph = new Map<string, string[]>();
    for (let i = 0; i < 200; i += 1) {
      graph.set(`node-${String(i)}`, i > 0 ? [`node-${String(i - 1)}`] : []);
    }
    expect(findCycle(graph)).toBeNull();
  });
});
