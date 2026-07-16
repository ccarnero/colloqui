// `IPlatformResourceClient` for agent-admin-service's `GET /admin/agents`
// (response is wrapped as `{ agents, total }`).
//
// The live projection uses `agentComparable.fromLive` — the SAME contract the
// manifest desired projection uses. `system_prompt`/`model_config` and
// UUID-keyed KB links stay existence-only (see `comparable-fields.ts`): no
// faithful mapping to the manifest's free-form `profile` and KB NAMES yet.
// `enabledMcpTools`/`toolDescriptionOverrides` (T04,
// manual-loops/provisioning-manifest-gaps-2.md gap 4) ARE faithfully
// comparable — `AGENT_ROW_COLUMNS` in agent-admin-service returns both
// verbatim — so `declaredResource` (the manifest's own agent, threaded
// through by `build-manifest-plan.ts`'s `findByName` call) is forwarded to
// `agentComparable.fromLive` exactly like `serviceComparable`'s scaling
// fields.

import type { Agent } from "@yoizen/shared";
import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import { type AgentDto, agentComparable } from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createAgentsClient(baseUrl: string): IPlatformResourceClient {
  return createHttpListResourceClient<AgentDto>({
    resourceKind: "agent",
    baseUrl,
    listPath: "/admin/agents",
    unwrapList: (body) => (body as { agents: AgentDto[] }).agents,
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item, declaredResource) =>
      agentComparable.fromLive(item, declaredResource as Agent | undefined),
  });
}
