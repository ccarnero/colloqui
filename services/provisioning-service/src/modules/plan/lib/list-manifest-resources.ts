// Flattens every manifest section into a uniform `{kind, name, external, resource}`
// list so the rest of the resolver/planner can iterate resources generically
// instead of switching on section per call site.

import type {
  Agent,
  Connector,
  HostedService,
  IntegrationManifest,
  ManifestChannel,
  Workflow,
} from "@yoizen/shared";
import type { ResourceKind } from "../domain/plan.interfaces";

export type AnyManifestResource =
  | ManifestChannel
  | Connector
  | Agent
  | HostedService
  | Workflow;

export interface ManifestResourceEntry {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly external: boolean;
  readonly resource: AnyManifestResource;
}

export function listManifestResources(
  manifest: IntegrationManifest
): ManifestResourceEntry[] {
  const entries: ManifestResourceEntry[] = [];

  for (const channel of manifest.spec.channels) {
    entries.push({
      kind: "channel",
      name: channel.name,
      external: channel.external ?? false,
      resource: channel,
    });
  }
  for (const connector of manifest.spec.connectors) {
    entries.push({
      kind: "connector",
      name: connector.name,
      external: connector.external ?? false,
      resource: connector,
    });
  }
  for (const agent of manifest.spec.agents) {
    entries.push({
      kind: "agent",
      name: agent.name,
      external: agent.external ?? false,
      resource: agent,
    });
  }
  for (const service of manifest.spec.services) {
    entries.push({
      kind: "service",
      name: service.name,
      external: service.external ?? false,
      resource: service,
    });
  }
  for (const workflow of manifest.spec.workflows) {
    entries.push({
      kind: "workflow",
      name: workflow.name,
      external: workflow.external ?? false,
      resource: workflow,
    });
  }

  return entries;
}
