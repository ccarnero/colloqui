// Nest provider factory: assembles the `PlatformResourceClients` map from
// config-driven downstream base URLs (see `src/config.ts`).

import { provisioningServiceConfig } from "../../../config";
import type { PlatformResourceClients } from "../domain/platform-resource-client.interface";
import { createAgentsClient } from "./agents-client";
import { createChannelsClient } from "./channels-client";
import { createConnectorsClient } from "./connectors-client";
import { createRegistryServicesClient } from "./registry-services-client";
import { createWorkflowsClient } from "./workflows-client";

export function buildPlatformResourceClients(): PlatformResourceClients {
  const urls = provisioningServiceConfig.downstreamServiceUrls;
  return {
    channel: createChannelsClient(urls.channels),
    connector: createConnectorsClient(urls.connectors),
    agent: createAgentsClient(urls.agents),
    service: createRegistryServicesClient(urls.registry),
    workflow: createWorkflowsClient(urls.workflows),
  };
}
