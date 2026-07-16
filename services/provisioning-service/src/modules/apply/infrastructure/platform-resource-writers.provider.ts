// Nest provider factory: assembles the `PlatformResourceWriters` map from
// the SAME config-driven downstream base URLs the T03 read-only clients use
// (`platform-resource-clients.provider.ts`).

import { provisioningServiceConfig } from "../../../config";
import type { PlatformResourceWriters } from "../domain/platform-resource-writer.interface";
import type { ISecretValueResolver } from "../domain/secret-value-resolver.interface";
import { createAgentsWriter } from "./agents-writer";
import { createChannelsWriter } from "./channels-writer";
import { createConnectorsWriter } from "./connectors-writer";
import { createMcpServersWriter } from "./mcp-servers-writer";
import { createRegistryServicesWriter } from "./registry-services-writer";
import { createSystemVariablesWriter } from "./system-variables-writer";
import { createWorkflowsWriter } from "./workflows-writer";

/**
 * T05: `secretResolver` is optional — when wired (see `apply.module.ts`),
 * the CHANNEL writer resolves a `secretRef` through the T05 secrets broker
 * instead of failing loud with `secret_not_resolvable` (its `accessToken`
 * field maps cleanly). Registry (hosted-service) + workflow writers remain
 * OUT of scope (SPEC.md: "hosted-service k8s-native env delivery is a later
 * concern"; decision 7/gap-1's `declarative-provisioning.md` scope excludes
 * agent/LLM credential wiring).
 *
 * T01 (manual-loops/provisioning-manifest-gaps.md, gap 1): the CONNECTOR
 * writer now ALSO takes `secretResolver` — its `auth` block resolves
 * bearer/api-key/basic secretRefs through the same broker resolver, mapped
 * into connector-admin's `authType`→`authConfig` shape (see
 * `connectors-writer.ts` header for the consumer-identity reuse rationale).
 *
 * T06 (manual-loops/provisioning-manifest-gaps.md, gap 6): the MCPSERVER
 * writer ALSO takes `secretResolver` — its `auth`/`headers` fields resolve
 * secretRefs through the same broker resolver (see `mcp-servers-writer.ts`).
 */
export function buildPlatformResourceWriters(
  secretResolver?: ISecretValueResolver
): PlatformResourceWriters {
  const urls = provisioningServiceConfig.downstreamServiceUrls;
  return {
    channel: createChannelsWriter(urls.channels, secretResolver),
    connector: createConnectorsWriter(urls.connectors, secretResolver),
    // T06 — same downstream base URL as agents: MCP servers live in
    // agent-admin-service.
    mcpServer: createMcpServersWriter(urls.agents, secretResolver),
    agent: createAgentsWriter(urls.agents),
    service: createRegistryServicesWriter(urls.registry),
    // T04 (manual-loops/provisioning-manifest-gaps.md, gap 4) — same
    // downstream base URL as agents: system variables live in
    // agent-admin-service.
    systemVariable: createSystemVariablesWriter(urls.agents),
    workflow: createWorkflowsWriter(urls.workflows),
  };
}
