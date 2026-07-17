// Nest provider factory: assembles the `PlatformResourceClients` map from
// config-driven downstream base URLs (see `src/config.ts`).

import { provisioningServiceConfig } from "../../../config";
import type { PlatformResourceClients } from "../domain/platform-resource-client.interface";
import { createAgentsClient } from "./agents-client";
import { createChannelsClient } from "./channels-client";
import { createConnectorsClient } from "./connectors-client";
import { createMcpServersClient } from "./mcp-servers-client";
import { createRegistryServicesClient } from "./registry-services-client";
import { createSkillsClient } from "./skills-client";
import { createSystemVariablesClient } from "./system-variables-client";
import { createWorkflowsClient } from "./workflows-client";

export function buildPlatformResourceClients(): PlatformResourceClients {
  const urls = provisioningServiceConfig.downstreamServiceUrls;
  return {
    channel: createChannelsClient(urls.channels),
    connector: createConnectorsClient(urls.connectors),
    // T06 (manual-loops/provisioning-manifest-gaps.md, gap 6) — MCP servers
    // live in agent-admin-service, same downstream base URL as agents.
    mcpServer: createMcpServersClient(urls.agents),
    // T01 (manual-loops/provisioning-manifest-gaps-3.md, workstream a) —
    // skills live in agent-admin-service, same downstream base URL as
    // agents/mcpServers/systemVariables.
    skill: createSkillsClient(urls.agents),
    agent: createAgentsClient(urls.agents),
    service: createRegistryServicesClient(urls.registry),
    // T04 — system variables live in agent-admin-service, same downstream
    // base URL as agents (`sdk/src/resources/system-variables/types.ts`
    // prior-art note).
    systemVariable: createSystemVariablesClient(urls.agents),
    workflow: createWorkflowsClient(urls.workflows),
  };
}
