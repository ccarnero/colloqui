// `IPlatformResourceClient` for agent-admin-service's `GET /admin/skills`
// (manual-loops/provisioning-manifest-gaps-3.md T01, workstream a). Response
// is wrapped as `{ skills, total }` (`SkillsService.findAll`'s shape,
// `total` always equals `skills.length` — no real server-side pagination,
// same gap `system-variables-client.ts`/the SDK's own `list()` documents),
// mirroring `system-variables-client.ts`'s `unwrapList` usage exactly. Same
// downstream base URL as agents/mcpServers/systemVariables (agent-admin-service).
//
// The live projection uses `skillComparable.fromLive` — see
// `comparable-fields.ts`'s `SkillDto` for why every projected field is
// faithfully comparable and none is credential-capable.

import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import { type SkillDto, skillComparable } from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createSkillsClient(baseUrl: string): IPlatformResourceClient {
  return createHttpListResourceClient<SkillDto>({
    resourceKind: "skill",
    baseUrl,
    listPath: "/admin/skills",
    unwrapList: (body) => (body as { skills: SkillDto[] }).skills,
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item) => skillComparable.fromLive(item),
  });
}
