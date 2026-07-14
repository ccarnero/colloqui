// `IPlatformResourceClient` for registry-service's `GET /services` (hosted
// services referenced by the manifest's `services` section, per SPEC's
// "serviceRef resolves through registry-service, same rule as workflow
// serviceCall").
//
// The live projection uses `serviceComparable.fromLive` — the SAME contract
// the manifest desired projection uses — so a matching service converges to
// `noop`. Comparison is env var NAMES only (never values, never secretRef
// bindings, never image/buildRef); see `comparable-fields.ts` for why.

import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import {
  type RegisteredServiceDto,
  serviceComparable,
} from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createRegistryServicesClient(
  baseUrl: string
): IPlatformResourceClient {
  return createHttpListResourceClient<RegisteredServiceDto>({
    resourceKind: "service",
    baseUrl,
    listPath: "/services",
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item) => serviceComparable.fromLive(item),
  });
}
