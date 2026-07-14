// Pure DFS cycle detector over a generic "requires" graph (node -> nodes it
// depends on). White/gray/black coloring — O(V+E), never hangs regardless of
// graph shape. Returns the cyclic path (e.g.
// `["workflow:wf-a", "service:svc-a", "workflow:wf-a"]`) or `null`.
//
// Deliberately decoupled from `IntegrationManifest` so it can be exercised
// directly against a synthetic graph — see
// `test/unit/plan/find-cycle.spec.ts` for why: the current (human-approved)
// T01 manifest schema has no `workflowRef` symbolic-ref type, so a
// schema-valid manifest cannot actually construct a
// "workflow → service → workflow" cycle end-to-end (only `workflow.definition`
// is arbitrary enough to embed forward refs; nothing can embed a ref back
// INTO a workflow). The algorithm is still verified directly against that
// exact shape.

export type Graph = ReadonlyMap<
  string,
  ReadonlySet<string> | readonly string[]
>;

type Color = "white" | "gray" | "black";

export function findCycle(graph: Graph): string[] | null {
  const color = new Map<string, Color>();
  for (const node of graph.keys()) {
    color.set(node, "white");
  }

  for (const node of graph.keys()) {
    if (color.get(node) === "white") {
      const cycle = visit(graph, node, color, []);
      if (cycle) {
        return cycle;
      }
    }
  }
  return null;
}

function visit(
  graph: Graph,
  node: string,
  color: Map<string, Color>,
  stack: string[]
): string[] | null {
  color.set(node, "gray");
  stack.push(node);

  const edges = graph.get(node) ?? [];
  for (const next of edges) {
    const nextColor = color.get(next);
    if (nextColor === "gray") {
      const cycleStart = stack.indexOf(next);
      return [...stack.slice(cycleStart), next];
    }
    if (nextColor === "white") {
      const cycle = visit(graph, next, color, stack);
      if (cycle) {
        return cycle;
      }
    }
  }

  stack.pop();
  color.set(node, "black");
  return null;
}
