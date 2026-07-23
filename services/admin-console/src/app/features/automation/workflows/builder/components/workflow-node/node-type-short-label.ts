import { EWorkflowNodeType } from "../../../domain/workflow-node.types";

/**
 * Tiny uppercase dock/badge labels per SPEC T03 — sourced verbatim from the
 * design mock's `dockItems` table
 * (`manual-loops/admin-console/design/Rediseño Terminal.dc.html:1561-1574`:
 * `{ name: "Channel", short: "CHAN" }`, `{ name: "JS Function", short: "JS" }`,
 * `{ name: "HTTP Connector", short: "HTTP" }`, `{ name: "MCP Tool", short: "MCP" }`,
 * `{ name: "Service Call", short: "SVC" }`, `{ name: "Publish Event", short: "EVT" }`,
 * `{ name: "Agent", short: "AGENT" }`, `{ name: "Parallel Branch", short: "PAR" }`,
 * `{ name: "Conditional", short: "IF" }`). Single source of truth shared by the
 * floating palette dock chips and the node-card type badge, so both surfaces
 * always agree.
 */
export const NODE_TYPE_SHORT_LABEL: Readonly<
  Record<EWorkflowNodeType, string>
> = {
  [EWorkflowNodeType.CHANNEL]: "CHAN",
  [EWorkflowNodeType.JS_FUNCTION]: "JS",
  [EWorkflowNodeType.ENDPOINT_CALL]: "HTTP",
  [EWorkflowNodeType.MCP_CALL]: "MCP",
  [EWorkflowNodeType.SERVICE_CALL]: "SVC",
  [EWorkflowNodeType.SERVICE_BUS_CALL]: "EVT",
  [EWorkflowNodeType.AGENT_CALL]: "AGENT",
  [EWorkflowNodeType.BRANCH]: "PAR",
  [EWorkflowNodeType.CONDITIONAL]: "IF",
};

/**
 * Resolves the tiny uppercase label for a node type. Falls back to an
 * uppercased, truncated copy of the raw type string for any value outside
 * `EWorkflowNodeType` (defensive fallback for future/unknown types, mirroring
 * `node-type-color.ts`'s own fallback pattern).
 */
export function nodeTypeShortLabel(type: string): string {
  const known = NODE_TYPE_SHORT_LABEL[type as EWorkflowNodeType];
  return known ?? type.toUpperCase().slice(0, 4);
}
