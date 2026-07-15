// Nest provider factory: assembles the `PlatformResourceWriters` map from
// the SAME config-driven downstream base URLs the T03 read-only clients use
// (`platform-resource-clients.provider.ts`).

import { provisioningServiceConfig } from "../../../config";
import type { PlatformResourceWriters } from "../domain/platform-resource-writer.interface";
import { createAgentsWriter } from "./agents-writer";
import { createChannelsWriter } from "./channels-writer";
import { createConnectorsWriter } from "./connectors-writer";
import { createRegistryServicesWriter } from "./registry-services-writer";
import { createWorkflowsWriter } from "./workflows-writer";

export function buildPlatformResourceWriters(): PlatformResourceWriters {
  const urls = provisioningServiceConfig.downstreamServiceUrls;
  return {
    channel: createChannelsWriter(urls.channels),
    connector: createConnectorsWriter(urls.connectors),
    agent: createAgentsWriter(urls.agents),
    service: createRegistryServicesWriter(urls.registry),
    workflow: createWorkflowsWriter(urls.workflows),
  };
}
