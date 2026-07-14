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
    case "secretRef":
      return null;
    default:
      return null;
  }
}
