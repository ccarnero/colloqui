/** Display color group for the waterfall's bars/diamonds and legend. */
export type BusinessFnGroup = "channel" | "platform" | "agent" | "other";

/**
 * Groups a `business_fn` value into one of the waterfall's three display
 * categories, per SPEC.md T05: channel (`ingress`, `channel-*`) / platform
 * (`workflow-*`, `connector-*`, `routing`) / agent (`agent-*`). Anything
 * outside these families (`audit`, `dlq`, `runtime-presence`,
 * `registry-sync`, `unknown`, …) falls back to `other` — see TAXONOMY.md §3
 * for the full `business_fn` value catalogue this groups.
 */
export function businessFnGroup(businessFn: string): BusinessFnGroup {
  // channel: stage-1 ingress + every stage-2/3 channel-service family
  // (channel-processing, channel-egress) — TAXONOMY.md §4 rules 2-5.
  if (businessFn === "ingress" || businessFn.startsWith("channel-")) {
    return "channel";
  }
  // platform: workflow execution, connector invocation, and trigger routing
  // — TAXONOMY.md §4 rule 11 (connector-invocation), rule 19
  // (workflow-execution). `routing` is a §3-catalogued `business_fn` value
  // with no producing rule in §4 today — included here per SPEC.md T05's
  // explicit mapping, forward-compatible for when a rule starts emitting it.
  if (
    businessFn.startsWith("workflow-") ||
    businessFn.startsWith("connector-") ||
    businessFn === "routing"
  ) {
    return "platform";
  }
  // agent: every agent-* lifecycle family — TAXONOMY.md §4 rules 6-9
  // (agent-execution, agent-admin, agent-scheduling, agent-memory) plus
  // rule 12 (agent-runtime-streaming).
  if (businessFn.startsWith("agent-")) {
    return "agent";
  }
  return "other";
}
