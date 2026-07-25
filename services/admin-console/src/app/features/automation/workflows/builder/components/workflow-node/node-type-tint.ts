import { EWorkflowNodeType } from "../../../domain/workflow-node.types";

/**
 * Neutral fallback tint token for the leading icon chip background, used by
 * every node kind without a dedicated entry below. Mirrors the design mock's
 * `KIND_TINT[n.kind] || "var(--hover)"` fallback (SPEC T03; see
 * `design/builder-v2-reference/node-card.html:51` and NOTES.md "Key
 * finding: no CSS classes, no per-node-type markup").
 */
export const NODE_TYPE_TINT_FALLBACK_TOKEN = "var(--rd-hover)";

/**
 * Node-type -> icon-chip tint token mapping (SPEC T03), ported verbatim from
 * the design mock's `KIND_TINT` table
 * (`design/builder-v2-reference/node-card.html:46`: `KIND_TINT = { channel:
 * "var(--green-dim)", conditional: "var(--yellow-dim)", agent:
 * "rgba(191,122,240,0.12)" }`), mapped onto `EWorkflowNodeType` the same way
 * `node-type-color.ts` maps `KIND_STRIPE` (decision 4, AMENDED — reused,
 * unchanged, by this task) — same three dedicated entries, same fallback
 * pattern. `--rd-purple-dim` already equals the mock's literal
 * `rgba(191,122,240,0.12)` (see `styles.scss` dark palette), so no new hex
 * literal is introduced here.
 */
export const NODE_TYPE_TINT_TOKEN: Readonly<
  Partial<Record<EWorkflowNodeType, string>>
> = {
  [EWorkflowNodeType.CHANNEL]: "var(--rd-green-dim)",
  [EWorkflowNodeType.CONDITIONAL]: "var(--rd-yellow-dim)",
  [EWorkflowNodeType.AGENT_CALL]: "var(--rd-purple-dim)",
};

/**
 * Resolves the icon-chip tint token for `type`, per SPEC T03. Falls back to
 * the neutral tint for any node kind without a dedicated entry (and for any
 * string outside `EWorkflowNodeType`), mirroring `node-type-color.ts`'s own
 * fallback pattern.
 */
export function nodeTypeTintToken(type: string): string {
  return (
    NODE_TYPE_TINT_TOKEN[type as EWorkflowNodeType] ??
    NODE_TYPE_TINT_FALLBACK_TOKEN
  );
}
