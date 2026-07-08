/**
 * Request/response types for the `agents` resource (`admin/agents`), hand-typed
 * against the REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/admin/admin-agents.controller.ts` (raw
 *   passthrough proxy, `AdminProxyService`) + `admin.dto.ts` for the gateway's
 *   own validation DTOs (`CreateAgentDto`, `UpdateAgentDto`,
 *   `UpdateEnabledToolsDto`, `UpdateEnabledMcpServersDto`,
 *   `UpdateToolDescriptionOverridesDto`, `AdminAgentsListQueryDto`).
 * - `services/agent-admin-service/src/modules/agents/agents.controller.ts` +
 *   `agents.repository.interface.ts` (`IAgent`, `IAgentVersion`) for the real
 *   validated/persisted shape.
 *
 * `POST /admin/agents/:id/revert`, `GET /admin/agents/memory-proposals`,
 * `POST /admin/agents/memory-proposals/:id/approve`, and `POST
 * /admin/agents/memory-proposals/:id/reject` are now proxied by the
 * gateway's `AdminAgentsController` (`revertAgent` / `memory-proposals`
 * declared BEFORE `:id` so Nest doesn't swallow it as an agent id /
 * `memory-proposals/:id/approve` / `memory-proposals/:id/reject`), backed
 * downstream by `agent-admin-service`'s `agents.controller.ts`
 * (`revertToPublished` / `listMemoryProposals` / `approveMemoryProposal` /
 * `rejectMemoryProposal`, `MemoryProposalListResponseDto` /
 * `MemoryProposalActionResponseDto` in `agents.dto.ts`). As of 2026-07-05
 * this gateway wiring exists in source but the dev cluster's running pod
 * still 404s (`revert`) / mis-routes `memory-proposals` as an agent id (400
 * "uuid is expected") — the fix is not yet hot-reloaded/deployed. See
 * `revert()` / `listMemoryProposals()` / `approveMemoryProposal()` /
 * `rejectMemoryProposal()`.
 *
 * Do not confuse this with the gateway's `admin/memories` resource
 * (`admin-memories.controller.ts`, proxied via `AgentMemoryProxyService` to
 * a separate `agent-memory` service, routes `GET /admin/memories/proposals`,
 * `PATCH /admin/memories/:id/approve`, `PATCH /admin/memories/:id/reject`)
 * — that is a different backend and a different feature (tenant-wide
 * conversation memories, see the `memories` resource), not this one.
 */

export interface CreateAgentInput {
  name: string;
  description?: string;
  system_prompt: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  channels?: unknown[];
  knowledge_base_ids?: string[];
  input_variables?: unknown[];
  output_variables?: unknown[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  system_prompt?: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  channels?: unknown[];
  is_active?: boolean;
}

/** Response shape for create/update/get/list items/publish/unpublish/rollback (`IAgent`). */
export interface Agent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_config: Record<string, unknown>;
  tools: unknown[];
  enabled_tools: string[] | null;
  enabled_mcp_servers: string[] | null;
  /**
   * Per-tool MCP allowlist, keyed by MCP server name (mcp-connections.md §4).
   * `null` for a server (or a missing key) means "all tools from that server
   * enabled" — the backward-compatible default; an array is an explicit
   * allowlist of tool names within that server.
   */
  enabled_mcp_tools: Record<string, string[] | null> | null;
  tool_description_overrides: Record<string, string> | null;
  channels: unknown[];
  knowledge_base_ids: string[];
  input_variables: unknown[];
  output_variables: unknown[];
  status: "draft" | "published" | "archived";
  is_active: boolean;
  /** ISO-8601 timestamp, or `null` when never published. */
  published_at: string | null;
  published_config: Record<string, unknown> | null;
  published_by?: string | null;
  /** ISO-8601 timestamp (serialized `Date`). */
  created_at: string;
  /** ISO-8601 timestamp (serialized `Date`). */
  updated_at: string;
}

/** One row of `GET /admin/agents/:id/versions` (`IAgentVersion`). */
export interface AgentVersion {
  id: string;
  agent_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  /** ISO-8601 timestamp, or `null` when never published. */
  published_at: string | null;
  /** ISO-8601 timestamp (serialized `Date`). */
  created_at: string;
  semver_major?: number;
  semver_minor?: number;
  semver_patch?: number;
  semver_label?: string;
  bump_type?: string;
  diff?: unknown;
  published_by?: string;
}

export interface ListAgentsParams {
  status?: "draft" | "published" | "archived";
  is_active?: boolean;
  /** Page size. Gateway-enforced max 500 (`packages/shared/src/paginated-query.dto.ts`). Default 50 (SDK-side, see `src/core/pagination.ts`). */
  pageSize?: number;
  /** Item offset to start iterating from. Default 0. */
  startOffset?: number;
}

/** Raw envelope returned by `GET /admin/agents` (`{ agents, total }` from `agent-admin-service`). */
export interface ListAgentsPage {
  agents: Agent[];
  total: number;
}

export interface UpdateEnabledToolsInput {
  enabled_tools: string[] | null;
}

export interface UpdateEnabledMcpServersInput {
  enabled_mcp_servers: string[] | null;
}

export interface UpdateEnabledMcpToolsInput {
  enabled_mcp_tools: Record<string, string[] | null> | null;
}

export interface UpdateToolDescriptionOverridesInput {
  tool_description_overrides: Record<string, string> | null;
}

/**
 * One entry of `GET /admin/agents/memory-proposals`
 * (`MemoryProposalDto` in `agents.dto.ts`).
 */
export interface AgentMemoryProposal {
  id: string;
  kind?: string;
  title?: string;
  content_excerpt?: string;
  status?: string;
  /** ISO-8601 timestamp, when set. */
  created_at?: string;
  /** ISO-8601 timestamp, when set. */
  updated_at?: string;
}

/** Response shape for `GET /admin/agents/memory-proposals` (`MemoryProposalListResponseDto`). */
export interface ListAgentMemoryProposalsResult {
  proposals: AgentMemoryProposal[];
}

/**
 * Response shape for `POST /admin/agents/memory-proposals/:id/approve`
 * and `.../reject` (`MemoryProposalActionResponseDto`).
 */
export interface AgentMemoryProposalActionResult {
  success: boolean;
  proposal?: AgentMemoryProposal;
}
