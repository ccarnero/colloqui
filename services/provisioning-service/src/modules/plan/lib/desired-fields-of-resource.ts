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
  HostedService,
  ManifestChannel,
  ManifestSystemVariable,
  Workflow,
} from "@yoizen/shared";
import type { ResourceKind } from "../domain/plan.interfaces";
import {
  agentComparable,
  channelComparable,
  connectorComparable,
  serviceComparable,
  systemVariableComparable,
  workflowComparable,
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
    case "agent":
      return agentComparable.fromManifest(resource as Agent);
    case "service":
      return serviceComparable.fromManifest(resource as HostedService);
    case "systemVariable":
      return systemVariableComparable.fromManifest(
        resource as ManifestSystemVariable
      );
    case "workflow":
      return workflowComparable.fromManifest(resource as Workflow);
    default:
      return {};
  }
}
