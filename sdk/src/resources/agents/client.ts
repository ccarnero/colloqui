import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  Agent,
  AgentMemoryProposalActionResult,
  AgentVersion,
  CreateAgentInput,
  ListAgentMemoryProposalsResult,
  ListAgentsPage,
  ListAgentsParams,
  UpdateAgentInput,
  UpdateEnabledMcpServersInput,
  UpdateEnabledToolsInput,
  UpdateToolDescriptionOverridesInput,
} from "./types.js";

export interface AgentsClientDeps {
  transport: Transport;
}

export interface AgentCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface AgentsClient {
  /** `POST /admin/agents` — create an agent (starts as `draft`). */
  create(input: CreateAgentInput, opts?: AgentCallOptions): Promise<Agent>;
  /** `PUT /admin/agents/:id` — partial update (only provided fields change). */
  update(
    id: string,
    input: UpdateAgentInput,
    opts?: AgentCallOptions
  ): Promise<Agent>;
  /**
   * `GET /admin/agents` — real `limit`/`offset` + `{ agents, total }`
   * pagination, adapted via `toOffsetPage`.
   */
  list(params?: ListAgentsParams): Paginated<Agent>;
  /** `GET /admin/agents/:id`. */
  get(id: string, opts?: AgentCallOptions): Promise<Agent>;
  /** `DELETE /admin/agents/:id`; resolves on 204. */
  remove(id: string, opts?: AgentCallOptions): Promise<void>;
  /** `POST /admin/agents/:id/publish` — snapshots current config as the published version. */
  publish(id: string, opts?: AgentCallOptions): Promise<Agent>;
  /** `POST /admin/agents/:id/unpublish`. */
  unpublish(id: string, opts?: AgentCallOptions): Promise<Agent>;
  /** `GET /admin/agents/:id/versions` — bare array, newest first. */
  listVersions(id: string, opts?: AgentCallOptions): Promise<AgentVersion[]>;
  /** `POST /admin/agents/:id/versions/:versionId/rollback`. */
  rollbackToVersion(
    id: string,
    versionId: string,
    opts?: AgentCallOptions
  ): Promise<Agent>;
  /** `DELETE /admin/agents/:id/versions/:versionId`; resolves on 204. */
  deleteVersion(
    id: string,
    versionId: string,
    opts?: AgentCallOptions
  ): Promise<void>;
  /** `PATCH /admin/agents/:id/tools`. */
  updateEnabledTools(
    id: string,
    input: UpdateEnabledToolsInput,
    opts?: AgentCallOptions
  ): Promise<Agent>;
  /** `PATCH /admin/agents/:id/mcp-servers`. */
  updateEnabledMcpServers(
    id: string,
    input: UpdateEnabledMcpServersInput,
    opts?: AgentCallOptions
  ): Promise<Agent>;
  /** `PATCH /admin/agents/:id/tool-descriptions`. */
  updateToolDescriptionOverrides(
    id: string,
    input: UpdateToolDescriptionOverridesInput,
    opts?: AgentCallOptions
  ): Promise<Agent>;
  /**
   * `POST /admin/agents/:id/revert` — discards the current draft and
   * restores the agent's config from its last published snapshot. As of
   * 2026-07-05 this route 404s on the dev cluster (fix not yet
   * deployed/hot-reloaded) — see `types.ts`.
   */
  revert(id: string, opts?: AgentCallOptions): Promise<Agent>;
  /**
   * `GET /admin/agents/memory-proposals`. As of 2026-07-05 the dev
   * cluster's gateway mis-routes `memory-proposals` as an agent id (400) —
   * see `types.ts`.
   */
  listMemoryProposals(
    opts?: AgentCallOptions
  ): Promise<ListAgentMemoryProposalsResult>;
  /** `POST /admin/agents/memory-proposals/:id/approve`. See `types.ts` for live-deploy status. */
  approveMemoryProposal(
    id: string,
    opts?: AgentCallOptions
  ): Promise<AgentMemoryProposalActionResult>;
  /** `POST /admin/agents/memory-proposals/:id/reject`. See `types.ts` for live-deploy status. */
  rejectMemoryProposal(
    id: string,
    opts?: AgentCallOptions
  ): Promise<AgentMemoryProposalActionResult>;
}

/**
 * Creates the `agents` namespace client (`admin/agents`). Follows the
 * `workflows` resource pattern (GROWTH-PLAN.md Phase 2) — see
 * sdk/README.md "Resource clients".
 */
export function createAgentsClient({
  transport,
}: AgentsClientDeps): AgentsClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateAgentInput,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: "/admin/agents",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateAgentInput,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}`,
      method: "PUT",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(params: ListAgentsParams = {}): Paginated<Agent> {
    return paginate<Agent>(
      async ({ limit, offset }) => {
        const query = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        if (params.status) {
          query.set("status", params.status);
        }
        if (params.is_active !== undefined) {
          query.set("is_active", String(params.is_active));
        }
        const { body } = await transport.request<ListAgentsPage>({
          path: `/admin/agents?${query.toString()}`,
          method: "GET",
        });
        return toOffsetPage(body.agents, body.total, offset);
      },
      { pageSize: params.pageSize, startOffset: params.startOffset }
    );
  }

  async function get(id: string, opts: AgentCallOptions = {}): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: AgentCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/admin/agents/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function publish(
    id: string,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}/publish`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function unpublish(
    id: string,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}/unpublish`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function listVersions(
    id: string,
    opts: AgentCallOptions = {}
  ): Promise<AgentVersion[]> {
    const { body } = await transport.request<AgentVersion[]>({
      path: `/admin/agents/${encodePath(id)}/versions`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function rollbackToVersion(
    id: string,
    versionId: string,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}/versions/${encodePath(versionId)}/rollback`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function deleteVersion(
    id: string,
    versionId: string,
    opts: AgentCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/admin/agents/${encodePath(id)}/versions/${encodePath(versionId)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function updateEnabledTools(
    id: string,
    input: UpdateEnabledToolsInput,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}/tools`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function updateEnabledMcpServers(
    id: string,
    input: UpdateEnabledMcpServersInput,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}/mcp-servers`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function updateToolDescriptionOverrides(
    id: string,
    input: UpdateToolDescriptionOverridesInput,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}/tool-descriptions`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function revert(
    id: string,
    opts: AgentCallOptions = {}
  ): Promise<Agent> {
    const { body } = await transport.request<Agent>({
      path: `/admin/agents/${encodePath(id)}/revert`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function listMemoryProposals(
    opts: AgentCallOptions = {}
  ): Promise<ListAgentMemoryProposalsResult> {
    const { body } = await transport.request<ListAgentMemoryProposalsResult>({
      path: "/admin/agents/memory-proposals",
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function approveMemoryProposal(
    id: string,
    opts: AgentCallOptions = {}
  ): Promise<AgentMemoryProposalActionResult> {
    const { body } = await transport.request<AgentMemoryProposalActionResult>({
      path: `/admin/agents/memory-proposals/${encodePath(id)}/approve`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function rejectMemoryProposal(
    id: string,
    opts: AgentCallOptions = {}
  ): Promise<AgentMemoryProposalActionResult> {
    const { body } = await transport.request<AgentMemoryProposalActionResult>({
      path: `/admin/agents/memory-proposals/${encodePath(id)}/reject`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  return {
    create,
    update,
    list,
    get,
    remove,
    publish,
    unpublish,
    listVersions,
    rollbackToVersion,
    deleteVersion,
    updateEnabledTools,
    updateEnabledMcpServers,
    updateToolDescriptionOverrides,
    revert,
    listMemoryProposals,
    approveMemoryProposal,
    rejectMemoryProposal,
  };
}
