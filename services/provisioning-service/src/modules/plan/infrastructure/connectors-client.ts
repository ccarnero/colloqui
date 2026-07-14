// `IPlatformResourceClient` for connector-admin's `GET /connectors`.
//
// The live projection uses `connectorComparable.fromLive` — the SAME contract
// the manifest desired projection uses. Connector comparison is
// existence-only (see `comparable-fields.ts`): connector-admin's structured
// adapter shape has no faithful mapping to the manifest's free-form
// `{ type, config }`.
//
// SECURITY: the `AdapterDto` this client reads deliberately EXCLUDES
// connector-admin's `authConfig` (which stores apiKey/bearerToken/
// basicPassword in plaintext, see packages/shared/adapter-auth-headers.ts).
// It is never fetched into the projection, so a plan can never surface a
// credential value. Enforced by
// `create-connectors-client-secret-scrub.spec.ts`.

import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import { type AdapterDto, connectorComparable } from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createConnectorsClient(
  baseUrl: string
): IPlatformResourceClient {
  return createHttpListResourceClient<AdapterDto>({
    resourceKind: "connector",
    baseUrl,
    listPath: "/connectors",
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item) => connectorComparable.fromLive(item),
  });
}
