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
    case "secretRef":
      return null;
    default:
      return null;
  }
}
