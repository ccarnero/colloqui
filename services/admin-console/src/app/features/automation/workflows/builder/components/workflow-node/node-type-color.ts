import { EWorkflowNodeType } from "../../../domain/workflow-node.types";

/**
 * Neutral fallback token used for every node kind the design mock does not
 * give a dedicated color, and for any value outside `EWorkflowNodeType`
 * (defensive fallback for future/unknown types). Mirrors the design mock's
 * own `KIND_STRIPE[n.kind] || "var(--line3)"` fallback pattern — see SPEC
 * finding 2, `manual-loops/admin-console/console-redesign-processes-builder.md:194-210`.
 */
export const NODE_TYPE_COLOR_FALLBACK_TOKEN = "var(--rd-text-3)";

/**
 * Node-type -> color-token mapping (SPEC decision 4, AMENDED 2026-07-22).
 * See `manual-loops/admin-console/console-redesign-processes-builder.md:32-38`
 * (amended decision text) and finding 2 (`:194-210`), which cites the design
 * mock's `KIND_STRIPE` table at `Rediseño Terminal.dc.html:1548-1549`:
 * `KIND_STRIPE = { channel: "var(--green)", conditional: "var(--yellow)",
 * agent: "var(--purple)" }`. Ports carry no per-port data type in the
 * domain model (`IWorkflowNode`/`IWorkflowConnection` — finding 2), so
 * coloring is keyed by `EWorkflowNodeType` instead, reusing that exact
 * three-entry table mapped onto existing `--rd-*` tokens. Every other node
 * kind (JS_FUNCTION, ENDPOINT_CALL, MCP_CALL, SERVICE_CALL,
 * SERVICE_BUS_CALL, BRANCH) falls through to the neutral fallback, matching
 * the design mock's own "no dedicated color for the rest" behavior
 * (finding 2, `:202-204`).
 */
export const NODE_TYPE_COLOR_TOKEN: Readonly<
  Partial<Record<EWorkflowNodeType, string>>
> = {
  [EWorkflowNodeType.CHANNEL]: "var(--rd-green)",
  [EWorkflowNodeType.CONDITIONAL]: "var(--rd-yellow)",
  [EWorkflowNodeType.AGENT_CALL]: "var(--rd-purple)",
};

/**
 * Whether `type` has a dedicated entry in `NODE_TYPE_COLOR_TOKEN`, i.e.
 * whether resolving its color will hit the neutral fallback. Exposed
 * separately so callers (e.g. `WorkflowNodeCardComponent`) can log fallback
 * hits without re-deriving the lookup.
 */
export function isKnownNodeTypeColor(type: string): boolean {
  return Object.hasOwn(NODE_TYPE_COLOR_TOKEN, type);
}

/**
 * Resolves the `--rd-*` color token for a node's port dots/accents by
 * `EWorkflowNodeType`, per SPEC decision 4 (AMENDED). Returns the neutral
 * fallback token for every node kind without a dedicated entry, and for
 * any string outside `EWorkflowNodeType`.
 */
export function nodeTypeColorToken(type: string): string {
  return (
    NODE_TYPE_COLOR_TOKEN[type as EWorkflowNodeType] ??
    NODE_TYPE_COLOR_FALLBACK_TOKEN
  );
}
