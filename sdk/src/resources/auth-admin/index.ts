/**
 * `@yoizen/platform-sdk/auth-admin` — the `authAdmin` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  AuthAdminCallOptions,
  AuthAdminClient,
  AuthAdminClientDeps,
  AuthAdminClientsClient,
  AuthAdminPublicRoutesClient,
  AuthAdminTenantRolesClient,
  AuthAdminTenantUsersClient,
  AuthAdminUsersClient,
} from "./client.js";
export { createAuthAdminClient } from "./client.js";
export type {
  AuthAdminClient_,
  AuthAdminPermission,
  AuthAdminPublicRoute,
  AuthAdminTenantRole,
  AuthAdminTenantRoleSummary,
  AuthAdminTenantUser,
  AuthAdminUser,
  CreateAuthAdminClientInput,
  CreateAuthAdminPublicRouteInput,
  CreateAuthAdminTenantRoleInput,
  CreateAuthAdminTenantUserInput,
  CreateAuthAdminUserInput,
  CreatedAuthAdminClient,
  UpdateAuthAdminTenantRoleInput,
  UpdateAuthAdminTenantUserInput,
} from "./types.js";
