import type { BumpType, IVersionDiff } from "./version-utils";

export const AGENTS_REPOSITORY = Symbol("AGENTS_REPOSITORY");

export interface ISemverPublishContext {
  semver: {
    major: number;
    minor: number;
    patch: number;
    label: string;
    bumpType: BumpType;
  };
  publishedBy: string;
  diff: IVersionDiff;
  versionNumber: number;
}

export interface IAgentVersion {
  id: string;
  agent_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  published_at: Date | null;
  created_at: Date;
  semver_major?: number;
  semver_minor?: number;
  semver_patch?: number;
  semver_label?: string;
  bump_type?: string;
  diff?: IVersionDiff;
  published_by?: string;
}

export interface IAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_config: Record<string, unknown>;
  tools: unknown[];
  enabled_tools: string[] | null;
  enabled_mcp_servers: string[] | null;
  /**
   * Per-tool MCP allowlist, keyed by MCP server name. `null` (or a missing
   * key) means "all tools from that server are enabled" — the backward-compatible
   * default. An array is an explicit allowlist of tool names within that server.
   * See mcp-connections.md §4.
   */
  enabled_mcp_tools: Record<string, string[] | null> | null;
  tool_description_overrides: Record<string, string> | null;
  channels: unknown[];
  knowledge_base_ids: string[];
  input_variables: unknown[];
  output_variables: unknown[];
  status: "draft" | "published" | "archived";
  is_active: boolean;
  published_at: Date | null;
  published_config: Record<string, unknown> | null;
  published_by?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateAgentData {
  name: string;
  description?: string;
  system_prompt: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  knowledge_base_ids?: string[];
  input_variables?: unknown[];
  output_variables?: unknown[];
  channels?: unknown[];
}

export interface IUpdateAgentData {
  name?: string;
  description?: string;
  system_prompt?: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  enabled_tools?: string[] | null;
  enabled_mcp_servers?: string[] | null;
  enabled_mcp_tools?: Record<string, string[] | null> | null;
  tool_description_overrides?: Record<string, string> | null;
  channels?: unknown[];
  knowledge_base_ids?: string[];
  input_variables?: unknown[];
  output_variables?: unknown[];
  status?: "draft" | "published" | "archived";
  is_active?: boolean;
}

export interface IFindAllAgentsOptions {
  status?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface IAgentsRepository {
  findAll(
    tenantId: string,
    options?: IFindAllAgentsOptions
  ): Promise<{ agents: IAgent[]; total: number }>;
  findById(tenantId: string, id: string): Promise<IAgent | null>;
  create(tenantId: string, data: ICreateAgentData): Promise<IAgent>;
  update(
    tenantId: string,
    id: string,
    data: IUpdateAgentData
  ): Promise<IAgent | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  publish(
    tenantId: string,
    id: string,
    context?: ISemverPublishContext
  ): Promise<IAgent | null>;
  unpublish(tenantId: string, id: string): Promise<IAgent | null>;
  revertToPublished(tenantId: string, id: string): Promise<IAgent | null>;
  listVersions(tenantId: string, agentId: string): Promise<IAgentVersion[]>;
  rollbackToVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<IAgent | null>;
  deleteVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<boolean>;
}
