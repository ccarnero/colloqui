import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateTenantAccepted,
  CreateTenantInput,
  TenantDetail,
  TenantSummary,
  UpdateTenantInput,
} from "./types.js";

export interface TenantsClientDeps {
  transport: Transport;
}

export interface TenantsCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface TenantsClient {
  /** `POST /tenants` — 202 Accepted; provisioning is asynchronous, see `types.ts`. */
  create(
    input: CreateTenantInput,
    opts?: TenantsCallOptions
  ): Promise<CreateTenantAccepted>;
  /** `GET /tenants` — bare array, degraded to a single page. */
  list(): Paginated<TenantSummary>;
  /** `GET /tenants/:nameOrId` — resolves by platform row UUID or tenant name. */
  get(nameOrId: string, opts?: TenantsCallOptions): Promise<TenantDetail>;
  /**
   * `PATCH /tenants/:name` — NOTE: resolves by `name` only (not id), unlike
   * `get()`. See `types.ts` for the confirmed gateway asymmetry.
   */
  update(
    name: string,
    input: UpdateTenantInput,
    opts?: TenantsCallOptions
  ): Promise<TenantDetail>;
  /**
   * `DELETE /tenants/:name`; resolves on 204. NOTE: resolves by `name` only
   * (not id), unlike `get()`.
   */
  remove(name: string, opts?: TenantsCallOptions): Promise<void>;
}

/**
 * Creates the `tenants` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients".
 */
export function createTenantsClient({
  transport,
}: TenantsClientDeps): TenantsClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateTenantInput,
    opts: TenantsCallOptions = {}
  ): Promise<CreateTenantAccepted> {
    const { body } = await transport.request<CreateTenantAccepted>({
      path: "/tenants",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(): Paginated<TenantSummary> {
    return paginate<TenantSummary>(async () => {
      const { body } = await transport.request<TenantSummary[]>({
        path: "/tenants",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function get(
    nameOrId: string,
    opts: TenantsCallOptions = {}
  ): Promise<TenantDetail> {
    const { body } = await transport.request<TenantDetail>({
      path: `/tenants/${encodePath(nameOrId)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    name: string,
    input: UpdateTenantInput,
    opts: TenantsCallOptions = {}
  ): Promise<TenantDetail> {
    const { body } = await transport.request<TenantDetail>({
      path: `/tenants/${encodePath(name)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    name: string,
    opts: TenantsCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/tenants/${encodePath(name)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  return { create, list, get, update, remove };
}
