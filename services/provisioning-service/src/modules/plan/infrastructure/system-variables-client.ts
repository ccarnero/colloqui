// `IPlatformResourceClient` for agent-admin-service's
// `GET /admin/system-variables` (manual-loops/provisioning-manifest-gaps.md
// T04, gap 4). Response is wrapped as `{ variables, total }`, mirroring
// `agents-client.ts`'s `{ agents, total }` envelope — same owning service
// (agent-admin-service), same `urls.agents` downstream base URL.
//
// The live projection uses `systemVariableComparable.fromLive` — the SAME
// contract the manifest desired projection uses (T04's `type`+`value` are
// BOTH faithfully comparable; `value` is CONFIG, never a secret VALUE, see
// `comparable-fields.ts`).

import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import {
  type SystemVariableDto,
  systemVariableComparable,
} from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createSystemVariablesClient(
  baseUrl: string
): IPlatformResourceClient {
  return createHttpListResourceClient<SystemVariableDto>({
    resourceKind: "systemVariable",
    baseUrl,
    listPath: "/admin/system-variables",
    unwrapList: (body) =>
      (body as { variables: SystemVariableDto[] }).variables,
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item) => systemVariableComparable.fromLive(item),
  });
}
