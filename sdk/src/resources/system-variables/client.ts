import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateSystemVariableInput,
  ListSystemVariablesPage,
  ListSystemVariablesParams,
  SystemVariable,
  UpdateSystemVariableInput,
} from "./types.js";

export interface SystemVariablesClientDeps {
  transport: Transport;
}

export interface SystemVariableCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface SystemVariablesClient {
  /** `POST /admin/system-variables`. */
  create(
    input: CreateSystemVariableInput,
    opts?: SystemVariableCallOptions
  ): Promise<SystemVariable>;
  /**
   * `GET /admin/system-variables` — real `limit`/`offset` query params are
   * sent, but the downstream ignores them today (always returns the full
   * set); see types.ts. Adapted via `toOffsetPage` for forward-compat.
   */
  list(params?: ListSystemVariablesParams): Paginated<SystemVariable>;
  /** `GET /admin/system-variables/:id`. Returns `null` (HTTP 200) instead of throwing when not found — see types.ts. */
  get(
    id: string,
    opts?: SystemVariableCallOptions
  ): Promise<SystemVariable | null>;
  /** `PATCH /admin/system-variables/:id`. Returns `null` (HTTP 200) instead of throwing when not found — see types.ts. */
  update(
    id: string,
    input: UpdateSystemVariableInput,
    opts?: SystemVariableCallOptions
  ): Promise<SystemVariable | null>;
  /** `DELETE /admin/system-variables/:id` — soft-delete. Returns a bare boolean — see types.ts. */
  remove(id: string, opts?: SystemVariableCallOptions): Promise<boolean>;
}

/**
 * Creates the `systemVariables` namespace client. Follows the `workflows`
 * reference implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients".
 */
export function createSystemVariablesClient({
  transport,
}: SystemVariablesClientDeps): SystemVariablesClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateSystemVariableInput,
    opts: SystemVariableCallOptions = {}
  ): Promise<SystemVariable> {
    const { body } = await transport.request<SystemVariable>({
      path: "/admin/system-variables",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(
    params: ListSystemVariablesParams = {}
  ): Paginated<SystemVariable> {
    return paginate<SystemVariable>(
      async ({ limit, offset }) => {
        const query = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        const { body } = await transport.request<ListSystemVariablesPage>({
          path: `/admin/system-variables?${query.toString()}`,
          method: "GET",
        });
        return toOffsetPage(body.variables, body.total, offset);
      },
      { pageSize: params.pageSize, startOffset: params.startOffset }
    );
  }

  async function get(
    id: string,
    opts: SystemVariableCallOptions = {}
  ): Promise<SystemVariable | null> {
    const { body } = await transport.request<SystemVariable | null>({
      path: `/admin/system-variables/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateSystemVariableInput,
    opts: SystemVariableCallOptions = {}
  ): Promise<SystemVariable | null> {
    const { body } = await transport.request<SystemVariable | null>({
      path: `/admin/system-variables/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: SystemVariableCallOptions = {}
  ): Promise<boolean> {
    const { body } = await transport.request<boolean>({
      path: `/admin/system-variables/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
    return body;
  }

  return { create, list, get, update, remove };
}
