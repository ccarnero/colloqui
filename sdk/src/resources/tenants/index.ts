/**
 * `@yoizen/platform-sdk/tenants` — the `tenants` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  TenantsCallOptions,
  TenantsClient,
  TenantsClientDeps,
} from "./client.js";
export { createTenantsClient } from "./client.js";
export type {
  CreateTenantAccepted,
  CreateTenantInput,
  ProvisioningStatus,
  TenantDatabaseTier,
  TenantDetail,
  TenantSummary,
  UpdateTenantInput,
} from "./types.js";
