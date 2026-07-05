/**
 * `@yoizen/platform-sdk/registry` — the `registry` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  RegistryCallOptions,
  RegistryCanaryClient,
  RegistryClient,
  RegistryClientDeps,
  RegistryRoutesClient,
  RegistryServicesClient,
} from "./client.js";
export { createRegistryClient } from "./client.js";
export type {
  CanaryStatus,
  CreateRouteInput,
  DiscoveredRoute,
  RegisteredService,
  RegisteredServiceDetail,
  RegisterServiceInput,
  RouteMethod,
  ServiceRevision,
  ServiceRoute,
  StartCanaryInput,
  UpdateCanaryInput,
  UpdateServiceInput,
} from "./types.js";
