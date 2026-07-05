/**
 * Request/response types for the `authAdmin` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 6):
 *
 * - `services/api-gateway/src/modules/auth/auth.controller.ts` (+
 *   `auth.dto.ts`, `auth-facade.service.ts`) define the gateway-side routes
 *   and validation. Every handler is a pure pass-through (`Promise<object>`)
 *   forwarding the raw JSON body/response verbatim to/from `auth-service` —
 *   there is no reshaping at the gateway.
 * - `services/auth-service/src/modules/users/{users.controller.ts,
 *   users.repository.interface.ts}`, `.../clients/*`,
 *   `.../tenant-users/{tenant-users.controller.ts, tenant-users.service.ts}`,
 *   `.../tenant-roles/{tenant-roles.controller.ts, tenant-role.types.ts}`,
 *   `.../public-routes/{public-routes.controller.ts,
 *   public-routes.repository.interface.ts}` define the real response shapes.
 *
 * This resource intentionally excludes `POST auth/token`, `POST auth/login`,
 * and `POST auth/refresh` — those are `@Public() @SkipTenant()` and already
 * covered by the SDK's built-in `Session` / login flow (see
 * `src/core/session.ts`), not a namespaced admin client.
 *
 * Known gaps / behavioral notes:
 * - All list endpoints below (`users`, `clients`, `tenantUsers`,
 *   `tenantRoles`, `publicRoutes`) return BARE ARRAYS today — none of them
 *   use `limit`/`offset` or a `{items,total}` envelope. Degraded to a single
 *   page via `toSinglePage()`.
 * - `GET auth/users` / `GET auth/clients` omit `is_active` from each row
 *   (`Omit<IUserRow,"is_active">` / `Omit<IClientRow,"is_active">` — the
 *   downstream `list()` methods explicitly strip it); `POST auth/clients`
 *   create response DOES include `is_active` plus a one-time
 *   `client_secret` field not present on any subsequent read.
 * - `tenantUsers` list/get/update routes have NO `@Scopes` decorator at the
 *   gateway (default guard rules apply) unlike `tenantRoles`, which requires
 *   explicit `roles:*` permissions — an inconsistency in the gateway's own
 *   authorization model, not something the SDK can paper over.
 * - `POST auth/clients` with a `scope` starting `tenant:` triggers a gateway
 *   -side `assertTenantExists()` check against tenant-service before
 *   proxying (400 if the tenant doesn't exist) — a gateway-level validation
 *   step, transparent to SDK callers.
 * - `POST auth/tenant-users` as a non-platform caller requires the caller to
 *   already hold the `SYSTEM_ROLE_TENANT_ADMIN` role; `tenant_id` is
 *   auto-filled/validated against the caller's own tenant scope when omitted.
 */

export interface AuthAdminUser {
  id: string;
  email: string;
  role: string;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

/** `POST /auth/users` body. */
export interface CreateAuthAdminUserInput {
  email: string;
  password: string;
  name?: string;
  role?: string;
}

export interface AuthAdminClient_ {
  id: string;
  client_id: string;
  name: string;
  scope: string;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

/** `POST /auth/clients` response — includes the one-time `client_secret` and `is_active`. */
export interface CreatedAuthAdminClient extends AuthAdminClient_ {
  is_active: boolean;
  client_secret: string;
}

/** `POST /auth/clients` body. */
export interface CreateAuthAdminClientInput {
  name: string;
  /** e.g. `"platform"` or `"tenant:<name>"`. A `tenant:` scope must reference an existing tenant. */
  scope?: string;
}

export interface AuthAdminTenantUser {
  id: string;
  tenant_id: string;
  email: string;
  role_id: string;
  role: string;
  display_name: string | null;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

/** `POST /auth/tenant-users` body. */
export interface CreateAuthAdminTenantUserInput {
  tenant_id?: string;
  email: string;
  /** Minimum 8 characters (downstream validation). */
  password: string;
  role_id: string;
  display_name?: string;
}

/** `PATCH /auth/tenant-users/:id` body. */
export interface UpdateAuthAdminTenantUserInput {
  role_id?: string;
  display_name?: string;
  is_active?: boolean;
}

export interface AuthAdminPermission {
  resource: string;
  action: string;
}

/** `GET /auth/tenant-roles` list row — summary shape, no `permissions`. */
export interface AuthAdminTenantRoleSummary {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  user_count: number;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

/** `GET /auth/tenant-roles/:id`, create, and update response — includes `permissions`. */
export interface AuthAdminTenantRole {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: AuthAdminPermission[];
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

/** `POST /auth/tenant-roles` body. */
export interface CreateAuthAdminTenantRoleInput {
  tenant_id?: string;
  /** Max 64 characters. */
  name: string;
  description?: string;
  permissions: AuthAdminPermission[];
}

/** `PATCH /auth/tenant-roles/:id` body. */
export interface UpdateAuthAdminTenantRoleInput {
  name?: string;
  description?: string;
  permissions?: AuthAdminPermission[];
}

export interface AuthAdminPublicRoute {
  id: string;
  method: string;
  path_pattern: string;
  scope: string;
  environment: string;
  /** ISO-8601 timestamp. */
  created_at: string;
}

/**
 * `POST /auth/public-routes` body. `path_pattern` bypasses the gateway's
 * `AuthGuard` for the given method/scope — use an obviously synthetic
 * pattern in tests/e2e, never a real production route.
 */
export interface CreateAuthAdminPublicRouteInput {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "*";
  path_pattern: string;
  /** `"platform"` or `"tenant:<name>"`. */
  scope: string;
}
