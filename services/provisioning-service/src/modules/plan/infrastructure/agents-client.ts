// `IPlatformResourceClient` for agent-admin-service's `GET /admin/agents`
// (response is wrapped as `{ agents, total }`).
//
// The live projection uses `agentComparable.fromLive` — the SAME contract the
// manifest desired projection uses. Agent comparison is existence-only today
// (see `comparable-fields.ts`): agent-admin's system_prompt/model_config and
// UUID-keyed KB links have no faithful mapping to the manifest's free-form
// `profile` and KB NAMES, so no credential- or value-bearing agent field is
// projected.

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
    getFields: (item) => agentComparable.fromLive(item),
  });
}
