// Projects a manifest resource into its DESIRED comparable-fields shape.
//
// Delegates to the per-kind contract in `comparable-fields.ts` — the SINGLE
// source of truth shared with the live-side projection each downstream client
// uses (`fromLive`). Because both sides derive from the same contract, the
// desired and live key sets always match, so `diffResource` never sees a
// one-sided key and a matching resource reaches `noop` (idempotency).
//
// Secret VALUES never appear here — the contract projects only non-secret,
// faithfully-comparable fields.

import type {
  Agent,
  Connector,
  ManifestChannel,
  ManifestMcpServer,
  ManifestSkill,
  ManifestSystemVariable,
} from "@yoizen/shared";
import type { ResourceKind } from "../domain/plan.interfaces";
import {
  agentComparable,
  channelComparable,
  connectorComparable,
  mcpServerComparable,
  skillComparable,
  systemVariableComparable,
} from "./comparable-fields";
import type { AnyManifestResource } from "./list-manifest-resources";

export function desiredFieldsOfResource(
  kind: ResourceKind,
  resource: AnyManifestResource
): Record<string, unknown> {
  switch (kind) {
    case "channel":
      return channelComparable.fromManifest(resource as ManifestChannel);
    case "connector":
      return connectorComparable.fromManifest(resource as Connector);
    // manual-loops/provisioning-manifest-gaps-2.md T07: without this case the
    // switch fell through to `default: {}`, projecting an EMPTY desired shape
    // for mcpServer while the mcp-servers-client projected the live side
    // (transport_type/url/enabled) — every field became a one-sided diff and
    // the mcpServer plan verdict was a FOREVER `update`. Both sides now share
    // `mcpServerComparable`, so a converged server reaches `noop`.
    case "mcpServer":
      return mcpServerComparable.fromManifest(resource as ManifestMcpServer);
    // T01 (manual-loops/provisioning-manifest-gaps-3.md, workstream a) — see
    // `skillComparable`'s header comment for why a missing case here would
    // cause the same forever-update loop mcpServer's T07 fix addressed.
    case "skill":
      return skillComparable.fromManifest(resource as ManifestSkill);
    case "agent":
      return agentComparable.fromManifest(resource as Agent);
    case "systemVariable":
      return systemVariableComparable.fromManifest(
        resource as ManifestSystemVariable
      );
    // Workflow is DELIBERATELY absent from this switch: its content-aware
    // projection requires the definition's symbolic refs to be substituted
    // with live ids FIRST, and that substitution needs plan-time I/O this
    // pure dispatcher cannot do. `build-manifest-plan.ts` branches around
    // this function for `kind === "workflow"` (substitute -> project, with
    // an existence-only fallback on unresolved refs). Wiring
    // `workflowComparable.fromManifest` here directly would feed it RAW
    // `{ channelRef: ... }` ref objects that can never equal the live side's
    // real ids — the exact forever-update trap the mcpServer/skill comments
    // above describe.
    //
    // Service is ALSO DELIBERATELY absent (manual-loops/crm-support-
    // telegram.md T04 findings — mechanism-aware env comparator): a
    // `{ connectorRef }` env value needs the SAME plan-time `resolvedIds`
    // substitution as workflow refs before it can be honestly compared
    // against the live side's resolved plain value — I/O this pure
    // dispatcher cannot do. `build-manifest-plan.ts` branches around this
    // function for `kind === "service"` too (`serviceEnvMechanismComparable`,
    // with a graceful fallback to the plain envNames-only `serviceComparable`
    // when an env ref cannot be resolved at plan time).
    default:
      return {};
  }
}
