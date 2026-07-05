import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  AuthAdminClient_,
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

export interface AuthAdminClientDeps {
  transport: Transport;
}

export interface AuthAdminCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface AuthAdminUsersClient {
  /** `POST /auth/users`. */
  create(
    input: CreateAuthAdminUserInput,
    opts?: AuthAdminCallOptions
  ): Promise<AuthAdminUser>;
  /** `GET /auth/users` — bare array (`is_active` omitted per row), degraded to a single page. */
  list(): Paginated<AuthAdminUser>;
}

export interface AuthAdminClientsClient {
  /** `POST /auth/clients` — response includes a one-time `client_secret`. */
  create(
    input: CreateAuthAdminClientInput,
    opts?: AuthAdminCallOptions
  ): Promise<CreatedAuthAdminClient>;
  /** `GET /auth/clients` — bare array (`is_active` omitted per row), degraded to a single page. */
  list(): Paginated<AuthAdminClient_>;
  /** `DELETE /auth/clients/:id`; resolves on 204. */
  remove(id: string, opts?: AuthAdminCallOptions): Promise<void>;
}

export interface AuthAdminTenantUsersClient {
  /** `POST /auth/tenant-users`. */
  create(
    input: CreateAuthAdminTenantUserInput,
    opts?: AuthAdminCallOptions
  ): Promise<AuthAdminTenantUser>;
  /** `GET /auth/tenant-users` — bare array, degraded to a single page. */
  list(): Paginated<AuthAdminTenantUser>;
  /** `GET /auth/tenant-users/:id`. */
  get(id: string, opts?: AuthAdminCallOptions): Promise<AuthAdminTenantUser>;
  /** `PATCH /auth/tenant-users/:id`. */
  update(
    id: string,
    input: UpdateAuthAdminTenantUserInput,
    opts?: AuthAdminCallOptions
  ): Promise<AuthAdminTenantUser>;
  /** `DELETE /auth/tenant-users/:id`; resolves on 204. */
  remove(id: string, opts?: AuthAdminCallOptions): Promise<void>;
}

export interface AuthAdminTenantRolesClient {
  /** `POST /auth/tenant-roles`. */
  create(
    input: CreateAuthAdminTenantRoleInput,
    opts?: AuthAdminCallOptions
  ): Promise<AuthAdminTenantRole>;
  /**
   * `GET /auth/tenant-roles` — bare array of role SUMMARIES (no
   * `permissions`, includes `user_count`), degraded to a single page.
   */
  list(): Paginated<AuthAdminTenantRoleSummary>;
  /** `GET /auth/tenant-roles/:id` — includes `permissions`. */
  get(id: string, opts?: AuthAdminCallOptions): Promise<AuthAdminTenantRole>;
  /** `PATCH /auth/tenant-roles/:id`. */
  update(
    id: string,
    input: UpdateAuthAdminTenantRoleInput,
    opts?: AuthAdminCallOptions
  ): Promise<AuthAdminTenantRole>;
  /** `DELETE /auth/tenant-roles/:id`; resolves on 204. */
  remove(id: string, opts?: AuthAdminCallOptions): Promise<void>;
}

export interface AuthAdminPublicRoutesClient {
  /**
   * `POST /auth/public-routes` — registers an unauthenticated route bypass.
   * See `types.ts` CAUTION: use an obviously synthetic `path_pattern` outside
   * production traffic.
   */
  create(
    input: CreateAuthAdminPublicRouteInput,
    opts?: AuthAdminCallOptions
  ): Promise<AuthAdminPublicRoute>;
  /** `GET /auth/public-routes` — bare array, degraded to a single page. */
  list(): Paginated<AuthAdminPublicRoute>;
  /** `DELETE /auth/public-routes/:id`; resolves on 204. */
  remove(id: string, opts?: AuthAdminCallOptions): Promise<void>;
}

export interface AuthAdminClient {
  users: AuthAdminUsersClient;
  clients: AuthAdminClientsClient;
  tenantUsers: AuthAdminTenantUsersClient;
  tenantRoles: AuthAdminTenantRolesClient;
  publicRoutes: AuthAdminPublicRoutesClient;
}

/**
 * Creates the `authAdmin` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients". Does NOT cover `token`/`login`/`refresh` — see `types.ts`.
 */
export function createAuthAdminClient({
  transport,
}: AuthAdminClientDeps): AuthAdminClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function usersCreate(
    input: CreateAuthAdminUserInput,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminUser> {
    const { body } = await transport.request<AuthAdminUser>({
      path: "/auth/users",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function usersList(): Paginated<AuthAdminUser> {
    return paginate<AuthAdminUser>(async () => {
      const { body } = await transport.request<AuthAdminUser[]>({
        path: "/auth/users",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function clientsCreate(
    input: CreateAuthAdminClientInput,
    opts: AuthAdminCallOptions = {}
  ): Promise<CreatedAuthAdminClient> {
    const { body } = await transport.request<CreatedAuthAdminClient>({
      path: "/auth/clients",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function clientsList(): Paginated<AuthAdminClient_> {
    return paginate<AuthAdminClient_>(async () => {
      const { body } = await transport.request<AuthAdminClient_[]>({
        path: "/auth/clients",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function clientsRemove(
    id: string,
    opts: AuthAdminCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/auth/clients/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function tenantUsersCreate(
    input: CreateAuthAdminTenantUserInput,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminTenantUser> {
    const { body } = await transport.request<AuthAdminTenantUser>({
      path: "/auth/tenant-users",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function tenantUsersList(): Paginated<AuthAdminTenantUser> {
    return paginate<AuthAdminTenantUser>(async () => {
      const { body } = await transport.request<AuthAdminTenantUser[]>({
        path: "/auth/tenant-users",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function tenantUsersGet(
    id: string,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminTenantUser> {
    const { body } = await transport.request<AuthAdminTenantUser>({
      path: `/auth/tenant-users/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function tenantUsersUpdate(
    id: string,
    input: UpdateAuthAdminTenantUserInput,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminTenantUser> {
    const { body } = await transport.request<AuthAdminTenantUser>({
      path: `/auth/tenant-users/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function tenantUsersRemove(
    id: string,
    opts: AuthAdminCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/auth/tenant-users/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function tenantRolesCreate(
    input: CreateAuthAdminTenantRoleInput,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminTenantRole> {
    const { body } = await transport.request<AuthAdminTenantRole>({
      path: "/auth/tenant-roles",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function tenantRolesList(): Paginated<AuthAdminTenantRoleSummary> {
    return paginate<AuthAdminTenantRoleSummary>(async () => {
      const { body } = await transport.request<AuthAdminTenantRoleSummary[]>({
        path: "/auth/tenant-roles",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function tenantRolesGet(
    id: string,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminTenantRole> {
    const { body } = await transport.request<AuthAdminTenantRole>({
      path: `/auth/tenant-roles/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function tenantRolesUpdate(
    id: string,
    input: UpdateAuthAdminTenantRoleInput,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminTenantRole> {
    const { body } = await transport.request<AuthAdminTenantRole>({
      path: `/auth/tenant-roles/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function tenantRolesRemove(
    id: string,
    opts: AuthAdminCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/auth/tenant-roles/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function publicRoutesCreate(
    input: CreateAuthAdminPublicRouteInput,
    opts: AuthAdminCallOptions = {}
  ): Promise<AuthAdminPublicRoute> {
    const { body } = await transport.request<AuthAdminPublicRoute>({
      path: "/auth/public-routes",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function publicRoutesList(): Paginated<AuthAdminPublicRoute> {
    return paginate<AuthAdminPublicRoute>(async () => {
      const { body } = await transport.request<AuthAdminPublicRoute[]>({
        path: "/auth/public-routes",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function publicRoutesRemove(
    id: string,
    opts: AuthAdminCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/auth/public-routes/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  return {
    users: { create: usersCreate, list: usersList },
    clients: {
      create: clientsCreate,
      list: clientsList,
      remove: clientsRemove,
    },
    tenantUsers: {
      create: tenantUsersCreate,
      list: tenantUsersList,
      get: tenantUsersGet,
      update: tenantUsersUpdate,
      remove: tenantUsersRemove,
    },
    tenantRoles: {
      create: tenantRolesCreate,
      list: tenantRolesList,
      get: tenantRolesGet,
      update: tenantRolesUpdate,
      remove: tenantRolesRemove,
    },
    publicRoutes: {
      create: publicRoutesCreate,
      list: publicRoutesList,
      remove: publicRoutesRemove,
    },
  };
}
