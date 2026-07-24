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
import { createSkillsWriter } from "./skills-writer";
import { createSystemVariablesWriter } from "./system-variables-writer";
import { createWorkflowsWriter } from "./workflows-writer";

/**
 * T05: `secretResolver` is optional — when wired (see `apply.module.ts`),
 * the CHANNEL writer resolves a `secretRef` through the T05 secrets broker
 * instead of failing loud with `secret_not_resolvable` (its `accessToken`
 * field maps cleanly). Workflow writer remains OUT of scope.
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
 *
 * manual-loops/provisioning-manifest-gaps-2.md T05 (gap 5, human ruling
 * 2026-07-16): the SERVICE (registry) writer's `env[].value` started
 * PLAIN-STRING-ONLY — no secretRef, no broker resolver dependency.
 * manual-loops/provisioning-manifest-gaps-4.md T04 (Option B, human ruling
 * 2026-07-24) lands the deferred k8s-native `secretKeyRef` follow-up: the
 * SERVICE writer now ALSO takes `secretResolver`, but ONLY for an EXISTENCE
 * CHECK (never resolves to plaintext — see `registry-services-writer.ts`'s
 * `buildEnvVars` header for the full mechanism).
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
    // T04 (manual-loops/provisioning-manifest-gaps-3.md, workstream a) — same
    // downstream base URL as agents/mcpServers: skills live in
    // agent-admin-service. Real create-or-update writer (T01 shipped a
    // type-satisfying stub only); no secretResolver — no skillSchema field is
    // credential-capable (decision 4).
    skill: createSkillsWriter(urls.agents),
    agent: createAgentsWriter(urls.agents),
    service: createRegistryServicesWriter(urls.registry, secretResolver),
    // T04 (manual-loops/provisioning-manifest-gaps.md, gap 4) — same
    // downstream base URL as agents: system variables live in
    // agent-admin-service.
    systemVariable: createSystemVariablesWriter(urls.agents),
    workflow: createWorkflowsWriter(urls.workflows),
  };
}
