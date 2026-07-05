import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateSkillInput,
  ListSkillsPage,
  ListSkillsParams,
  Skill,
  UpdateSkillInput,
} from "./types.js";

export interface SkillsClientDeps {
  transport: Transport;
}

export interface SkillCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface SkillsClient {
  /** `POST /admin/skills`. */
  create(input: CreateSkillInput, opts?: SkillCallOptions): Promise<Skill>;
  /**
   * `GET /admin/skills` — real `limit`/`offset` query params are sent, but
   * the downstream ignores them today (always returns the full set); see
   * types.ts. Adapted via `toOffsetPage` for forward-compat.
   */
  list(params?: ListSkillsParams): Paginated<Skill>;
  /** `GET /admin/skills/:id`. Returns `null` (HTTP 200) instead of throwing when not found — see types.ts. */
  get(id: string, opts?: SkillCallOptions): Promise<Skill | null>;
  /**
   * `PATCH /admin/skills/:id`. Returns `null` (HTTP 200) instead of throwing
   * when not found — see types.ts. WARNING: currently returns HTTP 500 for
   * every payload due to a downstream bug in `SkillsService.update` — see
   * types.ts for the verified root cause; not fixable client-side.
   */
  update(
    id: string,
    input: UpdateSkillInput,
    opts?: SkillCallOptions
  ): Promise<Skill | null>;
  /** `DELETE /admin/skills/:id` — soft-delete. Returns a bare boolean — see types.ts. */
  remove(id: string, opts?: SkillCallOptions): Promise<boolean>;
}

/**
 * Creates the `skills` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients".
 */
export function createSkillsClient({
  transport,
}: SkillsClientDeps): SkillsClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateSkillInput,
    opts: SkillCallOptions = {}
  ): Promise<Skill> {
    const { body } = await transport.request<Skill>({
      path: "/admin/skills",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(params: ListSkillsParams = {}): Paginated<Skill> {
    return paginate<Skill>(
      async ({ limit, offset }) => {
        const query = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        const { body } = await transport.request<ListSkillsPage>({
          path: `/admin/skills?${query.toString()}`,
          method: "GET",
        });
        return toOffsetPage(body.skills, body.total, offset);
      },
      { pageSize: params.pageSize, startOffset: params.startOffset }
    );
  }

  async function get(
    id: string,
    opts: SkillCallOptions = {}
  ): Promise<Skill | null> {
    const { body } = await transport.request<Skill | null>({
      path: `/admin/skills/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateSkillInput,
    opts: SkillCallOptions = {}
  ): Promise<Skill | null> {
    const { body } = await transport.request<Skill | null>({
      path: `/admin/skills/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: SkillCallOptions = {}
  ): Promise<boolean> {
    const { body } = await transport.request<boolean>({
      path: `/admin/skills/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
    return body;
  }

  return { create, list, get, update, remove };
}
