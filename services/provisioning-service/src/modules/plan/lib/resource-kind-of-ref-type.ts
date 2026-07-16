// Maps a symbolic ref type to the manifest section (ResourceKind) it
// resolves against. `secretRef` is intentionally excluded — secrets are leaf
// preconditions (`gatherSecretReferences`), not nodes in the dependency
// graph the resolver orders.

import type { SymbolicRefType } from "@yoizen/shared";
import type { ResourceKind } from "../domain/plan.interfaces";

export function resourceKindOfRefType(
  refType: SymbolicRefType
): ResourceKind | null {
  switch (refType) {
    case "channelRef":
      return "channel";
    case "agentRef":
      return "agent";
    case "serviceRef":
      return "service";
    // manual-loops/provisioning-manifest-gaps.md T03, gap 3 — connectorRef
    // resolves against the manifest's `connectors` section, so a
    // connectorRef occurrence becomes a dependency edge exactly like the
    // other three resource-kind refs.
    case "connectorRef":
      return "connector";
    // manual-loops/provisioning-manifest-gaps.md T06, gap 6 — mcpServerRef
    // resolves against the manifest's `mcpServers` section, used by a
    // workflow `mcpCall` action's `serverId` argument (`{ mcpServerRef: name }`
    // embedded in `workflow.definition`, see `substitution-allowlist.ts`) —
    // that occurrence IS picked up by `collectSymbolicRefs`'s structural walk
    // and becomes a real dependency-graph edge via this mapping.
    // `agentSchema.enabledMcpServerRefs`, by contrast, is a plain array of
    // NAME strings (not the `{ mcpServerRef: name }` ref-object shape), so it
    // is NEVER picked up by `collectSymbolicRefs` and creates NO per-instance
    // dependency edge — it relies solely on `RESOURCE_KIND_ORDER` placing
    // `mcpServer` before `agent` unconditionally (same precedent as
    // `knowledgeBaseRefs`, which isn't in the ref-graph either).
    case "mcpServerRef":
      return "mcpServer";
    case "secretRef":
      return null;
    default:
      return null;
  }
}
