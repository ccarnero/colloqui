// `IPlatformResourceClient` for agent-admin-service's `GET /admin/mcp-servers`
// (manual-loops/provisioning-manifest-gaps.md T06, gap 6). Response is a bare
// array (`McpServersController.findAll` -> `IMcpServer[]`, no `{items, total}`
// envelope, no query params forwarded — mirrors `workflows-client.ts`, see
// `sdk/src/resources/mcp-servers/types.ts`'s own header comment on this).
//
// The live projection uses `mcpServerComparable.fromLive` — see
// `comparable-fields.ts`'s `McpServerDto` for why `headers`/`authType`/
// `authConfig` are not even readable from this DTO (never projected, never a
// credential-leak vector).

import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import {
  type McpServerDto,
  mcpServerComparable,
} from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createMcpServersClient(
  baseUrl: string
): IPlatformResourceClient {
  return createHttpListResourceClient<McpServerDto>({
    resourceKind: "mcpServer",
    baseUrl,
    listPath: "/admin/mcp-servers",
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item) => mcpServerComparable.fromLive(item),
  });
}
