import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateMemoryInput,
  ListMemoriesParams,
  ListMemoryProposalsParams,
  Memory,
  UpdateMemoryInput,
} from "./types.js";

export interface MemoriesClientDeps {
  transport: Transport;
}

export interface MemoriesCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface MemoriesClient {
  /** `POST /admin/memories` (201). See `types.ts`: `title` is required downstream. */
  create(input: CreateMemoryInput, opts?: MemoriesCallOptions): Promise<Memory>;
  /** `GET /admin/memories` — real `limit`/`offset` + `{items,total}` pagination. */
  list(params?: ListMemoriesParams): Paginated<Memory>;
  /**
   * `GET /admin/memories/proposals` — same envelope as `list()`, but the
   * downstream handler forces `status: PROPOSED` regardless of caller input.
   */
  listProposals(params?: ListMemoryProposalsParams): Paginated<Memory>;
  /** `GET /admin/memories/:id`. */
  get(id: string, opts?: MemoriesCallOptions): Promise<Memory>;
  /** `PATCH /admin/memories/:id`. See `types.ts`: `topicKey` has no effect downstream. */
  update(
    id: string,
    input: UpdateMemoryInput,
    opts?: MemoriesCallOptions
  ): Promise<Memory>;
  /** `PATCH /admin/memories/:id/approve` — 404s (not 409) if `status !== "PROPOSED"`. */
  approve(id: string, opts?: MemoriesCallOptions): Promise<Memory>;
  /** `PATCH /admin/memories/:id/reject` — 404s (not 409) if `status !== "PROPOSED"`. */
  reject(id: string, opts?: MemoriesCallOptions): Promise<Memory>;
  /** `DELETE /admin/memories/:id`; resolves on 204. */
  remove(id: string, opts?: MemoriesCallOptions): Promise<void>;
}

/**
 * Creates the `memories` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients". Proxies to `agent-memory-service`, not `agent-admin-service` —
 * see `types.ts`.
 */
export function createMemoriesClient({
  transport,
}: MemoriesClientDeps): MemoriesClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  function toQuery(
    params: Record<string, string | number | boolean | undefined>
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    return qs.length > 0 ? `?${qs}` : "";
  }

  async function create(
    input: CreateMemoryInput,
    opts: MemoriesCallOptions = {}
  ): Promise<Memory> {
    const { body } = await transport.request<Memory>({
      path: "/admin/memories",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(params: ListMemoriesParams = {}): Paginated<Memory> {
    return paginate<Memory>(async ({ limit, offset }) => {
      const { body } = await transport.request<{
        items: Memory[];
        total: number;
      }>({
        path: `/admin/memories${toQuery({
          scope: params.scope,
          kind: params.kind,
          status: params.status,
          search: params.search,
          includeExpired: params.includeExpired,
          sessionId: params.sessionId,
          userId: params.userId,
          limit: params.limit ?? limit,
          offset: params.offset ?? offset,
        })}`,
        method: "GET",
      });
      return toOffsetPage(body.items, body.total, params.offset ?? offset);
    });
  }

  function listProposals(
    params: ListMemoryProposalsParams = {}
  ): Paginated<Memory> {
    return paginate<Memory>(async ({ limit, offset }) => {
      const { body } = await transport.request<{
        items: Memory[];
        total: number;
      }>({
        path: `/admin/memories/proposals${toQuery({
          scope: params.scope,
          kind: params.kind,
          search: params.search,
          limit: params.limit ?? limit,
          offset: params.offset ?? offset,
        })}`,
        method: "GET",
      });
      return toOffsetPage(body.items, body.total, params.offset ?? offset);
    });
  }

  async function get(
    id: string,
    opts: MemoriesCallOptions = {}
  ): Promise<Memory> {
    const { body } = await transport.request<Memory>({
      path: `/admin/memories/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateMemoryInput,
    opts: MemoriesCallOptions = {}
  ): Promise<Memory> {
    const { body } = await transport.request<Memory>({
      path: `/admin/memories/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function approve(
    id: string,
    opts: MemoriesCallOptions = {}
  ): Promise<Memory> {
    const { body } = await transport.request<Memory>({
      path: `/admin/memories/${encodePath(id)}/approve`,
      method: "PATCH",
      retry: opts.retry,
    });
    return body;
  }

  async function reject(
    id: string,
    opts: MemoriesCallOptions = {}
  ): Promise<Memory> {
    const { body } = await transport.request<Memory>({
      path: `/admin/memories/${encodePath(id)}/reject`,
      method: "PATCH",
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: MemoriesCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/admin/memories/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  return {
    create,
    list,
    listProposals,
    get,
    update,
    approve,
    reject,
    remove,
  };
}
