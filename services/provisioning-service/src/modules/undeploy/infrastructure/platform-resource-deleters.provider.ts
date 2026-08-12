// Nest provider factory: assembles the `PlatformResourceDeleters` map from
// the SAME config-driven downstream base URLs the read clients and the apply
// writers use (`src/config.ts`) — mirrors
// `plan/infrastructure/platform-resource-clients.provider.ts`.
//
// ============================================================================
// OWNERSHIP INVENTORY (PENDIENTES/12-undeploy.spec.md T01 item 2)
//
// Per kind: the DELETION KEY undeploy matches a live resource with, and the
// downstream DELETE route it calls. Every route below was verified TWICE on
// 2026-08-12: in this repo's controller source (cited) and LIVE against the
// running dev cluster (`DELETE <route>/<random-uuid>`, observed status in the
// last column). NO kind is missing a delete route today — there is no
// `skipped_no_delete_api` outcome in practice, only the defensive path for a
// kind whose deleter is not wired.
//
//  kind           | deletion key                        | downstream DELETE route                                    | source (file:line)                                                   | live probe
//  ---------------|-------------------------------------|------------------------------------------------------------|----------------------------------------------------------------------|------------
//  channel        | name + externalId == "manifest:<CHANNEL name>" (apply-provenance, NOT per-manifest — see below)
//                 |                                     | channel-service      DELETE /channels/accounts/:id           | services/channel-service/.../accounts/accounts.controller.ts:88       | 404 "Account not found"
//  connector      | name (find-by-name, plan client)    | connector-admin      DELETE /connectors/:id                  | services/connector-admin/.../adapters/adapters.controller.ts:103      | 404 "Adapter ... not found"
//  mcpServer      | name (find-by-name, plan client)    | agent-admin          DELETE /admin/mcp-servers/:id            | services/agent-admin-service/.../mcp-servers.controller.ts:143        | 404 "MCP server ... not found"
//  skill          | name (find-by-name, plan client)    | agent-admin          DELETE /admin/skills/:id                 | services/agent-admin-service/.../skills.controller.ts:57              | 200 `false`
//  agent          | name (find-by-name, plan client)    | agent-admin          DELETE /admin/agents/:id                 | services/agent-admin-service/.../agents.controller.ts:100             | 404 "Agent ... not found"
//  knowledgeBase  | name (IAgentAdminKbClient)          | agent-admin          DELETE /admin/knowledge-bases/:id        | services/agent-admin-service/.../knowledge-bases.controller.ts:57     | 200 `false`
//  service        | name (find-by-name, plan client)    | registry-service     DELETE /services/:id                     | services/registry-service/.../services/services.controller.ts:49      | 404 "Service ... not found"
//  systemVariable | name (find-by-name, plan client)    | agent-admin          DELETE /admin/system-variables/:id       | services/agent-admin-service/.../system-variables.controller.ts:51    | 200 `false`
//  workflow       | name (find-by-name, plan client)    | workflow-service     DELETE /workflows/:id                    | services/workflow-service/.../workflows/workflows.controller.ts:117   | 404 "Workflow definition not found"
//
// NO kind has a per-MANIFEST ownership marker. `channel` is the only kind
// with a marker at all: `channels-writer.ts:186` stamps
// `externalId: "manifest:${channel.name}"` on create — derived from the
// CHANNEL RESOURCE's name, NOT from the manifest's `metadata.name`. So it
// proves APPLY-PROVENANCE ("apply created this account, it was not adopted
// from a hand-made one") and nothing about WHICH manifest created it
// (reviewer B, 2026-08-12: the first cut of this deleter matched the manifest
// name — a value the writer never stamps — so every manifest whose name
// differs from its channel's found nothing and silently left the account
// live). Every other kind falls back to the documented default: the stored
// manifest's resource NAME, resolved by the SAME find-by-name the writers
// already use for create-or-update. No name-pattern guessing beyond that,
// ever.
//
// FINDING (writer round — out of scope here, the apply path is untouchable in
// this task): two manifests of ONE tenant declaring the same resource name are
// indistinguishable at teardown for EVERY kind, channels included; undeploying
// either would delete the shared resource. A per-manifest stamp on create
// (`manifest:<manifest>/<resource>`) is the fix and it belongs to the writers.
//
// Registry ROUTES are not a separate kind: they are children of a service and
// go with `DELETE /services/:id`. Agents are deleted directly whether or not
// they are published (decision 5: delete implies unpublish).
// ============================================================================

import { provisioningServiceConfig } from "../../../config";
import { createAgentAdminKbClient } from "../../kb/infrastructure/agent-admin-kb-client";
import type { PlatformResourceClients } from "../../plan/domain/platform-resource-client.interface";
import type { PlatformResourceDeleters } from "../domain/platform-resource-deleter.interface";
import { createChannelsDeleter } from "./channels-deleter";
import { createHttpResourceDeleter } from "./create-http-resource-deleter";
import { createKnowledgeBasesDeleter } from "./knowledge-bases-deleter";

export function buildPlatformResourceDeleters(
  clients: PlatformResourceClients
): PlatformResourceDeleters {
  const urls = provisioningServiceConfig.downstreamServiceUrls;
  return {
    // The ONE kind with a marker of any sort (apply-provenance, not
    // per-manifest) — see `channels-deleter.ts`'s header.
    channel: createChannelsDeleter(urls.channels),
    connector: createHttpResourceDeleter({
      resourceKind: "connector",
      baseUrl: urls.connectors,
      deletePath: "/connectors",
      readClient: clients.connector,
    }),
    mcpServer: createHttpResourceDeleter({
      resourceKind: "mcpServer",
      baseUrl: urls.agents,
      deletePath: "/admin/mcp-servers",
      readClient: clients.mcpServer,
    }),
    skill: createHttpResourceDeleter({
      resourceKind: "skill",
      baseUrl: urls.agents,
      deletePath: "/admin/skills",
      readClient: clients.skill,
    }),
    agent: createHttpResourceDeleter({
      resourceKind: "agent",
      baseUrl: urls.agents,
      deletePath: "/admin/agents",
      readClient: clients.agent,
    }),
    knowledgeBase: createKnowledgeBasesDeleter(
      urls.agents,
      createAgentAdminKbClient(urls.agents)
    ),
    service: createHttpResourceDeleter({
      resourceKind: "service",
      baseUrl: urls.registry,
      deletePath: "/services",
      readClient: clients.service,
    }),
    systemVariable: createHttpResourceDeleter({
      resourceKind: "systemVariable",
      baseUrl: urls.agents,
      deletePath: "/admin/system-variables",
      readClient: clients.systemVariable,
    }),
    workflow: createHttpResourceDeleter({
      resourceKind: "workflow",
      baseUrl: urls.workflows,
      deletePath: "/workflows",
      readClient: clients.workflow,
    }),
  };
}
