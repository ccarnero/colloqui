// ---------------------------------------------------------------------------
// Variable types (mirrors @yoizen/shared variable.interfaces.ts)
// ---------------------------------------------------------------------------

export type VariableType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "array"
  | "secret";

export interface VariableDeclaration {
  name: string;
  type: VariableType;
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
}

// ---------------------------------------------------------------------------
// Tool source types and adapter reference
// ---------------------------------------------------------------------------

/** Discriminator for how a tool reaches its backend. */
export type ToolSourceType = "http" | "adapter" | "builtin";

/** Reference to an adapter and one of its endpoints. */
export interface IToolAdapterRef {
  adapterId: string;
  endpointId: string;
}

/** Describes a single input parameter for an HTTP tool. */
export interface IToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required: boolean;
  enum?: string[];
}

/** Built-in tool definition returned by GET /tools/builtins. */
export interface IBuiltinTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  builtin: boolean;
  readOnly?: boolean;
}

/** MCP server configuration. */
export interface IMcpServer {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  transport_type: "http" | "sse";
  url: string;
  headers: Record<string, string> | null;
  enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Frontend tool draft used inside the agent form.
 * Each tool is either an HTTP endpoint or backed by a registered adapter.
 */
export interface IAgentToolDraft {
  name: string;
  description?: string;
  sourceType: ToolSourceType;
  /** HTTP endpoint fields. */
  endpointUrl: string;
  endpointMethod: string;
  /** Adapter fields. */
  adapterRef: IToolAdapterRef | null;
  /** Input parameter definitions for HTTP tools. */
  parameters: IToolParameter[];
}

/** Backend tool payload sent to the API. */
export interface IAgentToolPayload {
  name: string;
  description?: string;
  source_type: ToolSourceType;
  endpoint?: { url: string; method: string };
  adapter_ref?: { adapter_id: string; endpoint_id: string };
  builtin?: boolean;
  parameters?: Record<string, unknown>; // JSON Schema
}

// ---------------------------------------------------------------------------
// Agent statuses
// ---------------------------------------------------------------------------

export const AGENT_STATUSES = {
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
} as const;

export type AgentStatus =
  (typeof AGENT_STATUSES)[keyof typeof AGENT_STATUSES];

export interface ISubagentConfig {
  name: string;
  system_prompt: string;
  description?: string;
  enabled?: boolean;
  catalog_skill_id?: string;
}

export interface IAgentModelConfigLlm {
  provider: string;
  model: string;
  connectorId: string | null;
  temperature?: number;
  maxTokens?: number;
}

export interface IAgentModelConfig {
  llm?: IAgentModelConfigLlm;
  /** Flat shape returned by the backend (provider/model/connectorId at root). */
  provider?: string;
  model?: string;
  connectorId?: string | null;
  credential_profile_id?: string | null;
  rules: string;
  soul: string;
  subagents: ISubagentConfig[];
}

export interface IAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_config: IAgentModelConfig;
  tools: unknown[];
  enabled_tools: string[] | null;
  enabled_mcp_servers: string[] | null;
  tool_description_overrides: Record<string, string> | null;
  channels: unknown[];
  status: AgentStatus;
  is_active: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  published_config: Record<string, unknown> | null;
  input_variables?: VariableDeclaration[];
  output_variables?: VariableDeclaration[];
  knowledge_base_ids?: string[];
  published_by?: string | null;
}

export interface IAgentVersion {
  id: string;
  agent_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  published_at: string | null;
  created_at: string;
  // New SemVer fields (optional for backward compat with old versions)
  semver_major?: number;
  semver_minor?: number;
  semver_patch?: number;
  semver_label?: string;
  bump_type?: "major" | "minor" | "patch";
  diff?: {
    added: string[];
    removed: string[];
    modified: Array<{ field: string; before: unknown; after: unknown }>;
  };
  published_by?: string;
}

export interface IAgentListResponse {
  agents: IAgent[];
  total: number;
}

export interface IAgentListQuery {
  status?: AgentStatus;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface IChatContextEntry {
  sender: "customer" | "agent";
  content: string;
}

export interface IChatRequest {
  message: string;
  conversationId: string;
  channel?: string;
  customerName?: string;
  userId?: string;
  context: IChatContextEntry[];
}

// ---------------------------------------------------------------------------
// Memory types (agent-memory-service)
// ---------------------------------------------------------------------------

export const MEMORY_SCOPE = {
  SESSION: "SESSION",
  USER: "USER",
  TENANT: "TENANT",
} as const;

export type MemoryScope = (typeof MEMORY_SCOPE)[keyof typeof MEMORY_SCOPE];

export const MEMORY_KIND = {
  PREFERENCE: "PREFERENCE",
  FACT: "FACT",
  NOTICE: "NOTICE",
  INCIDENT: "INCIDENT",
  PROMO: "PROMO",
} as const;

export type MemoryKind = (typeof MEMORY_KIND)[keyof typeof MEMORY_KIND];

export const MEMORY_STATUS = {
  PROPOSED: "PROPOSED",
  ACTIVE: "ACTIVE",
  PUBLISHED: "PUBLISHED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  ARCHIVED: "ARCHIVED",
} as const;

export type MemoryStatus = (typeof MEMORY_STATUS)[keyof typeof MEMORY_STATUS];

export interface IAgentMemory {
  id: string;
  tenantId: string;
  userId?: string;
  sessionId?: string;
  scope: MemoryScope;
  kind: MemoryKind;
  status: MemoryStatus;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  topicKey?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IAgentMemoryListResponse {
  items: IAgentMemory[];
  total: number;
}

export interface IAgentMemoryQuery {
  scope?: MemoryScope;
  kind?: MemoryKind;
  status?: MemoryStatus;
  search?: string;
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
  sessionId?: string;
  userId?: string;
  context?: string;
}

export interface IAgentMemoryCreatePayload {
  scope: MemoryScope;
  kind: MemoryKind;
  title: string;
  content: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  topicKey?: string;
  ttl?: number;
}

export interface IAgentMemoryUpdatePayload {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  topicKey?: string;
}

export interface ISubagentDraft {
  name: string;
  systemPrompt: string;
  description?: string;
  enabled?: boolean;
  source?: "manual" | "catalog";
  catalogSkillId?: string;
}

export interface IAgentDraft {
  name: string;
  description?: string;
  systemPrompt: string;
  provider: string;
  model: string;
  connectorId?: string | null;
  temperature?: number;
  maxTokens?: number;
  rules: string;
  soul: string;
  subagents?: ISubagentDraft[];
  tools?: readonly unknown[];
  channels?: readonly unknown[];
  inputVariables?: VariableDeclaration[];
  outputVariables?: VariableDeclaration[];
  knowledgeBaseIds?: string[];
}

export interface ICreateAgentPayload {
  name: string;
  description?: string;
  system_prompt: string;
  model_config: IAgentModelConfig;
  tools?: unknown[];
  channels?: unknown[];
  input_variables?: VariableDeclaration[];
  output_variables?: VariableDeclaration[];
  knowledge_base_ids?: string[];
}

export function getAgentLlmConfig(modelConfig: IAgentModelConfig): {
  provider: string;
  model: string;
  connectorId: string | null;
  temperature?: number;
  maxTokens?: number;
} {
  if (modelConfig.llm) {
    return {
      provider: modelConfig.llm.provider,
      model: modelConfig.llm.model,
      connectorId: modelConfig.llm.connectorId,
      temperature: modelConfig.llm.temperature,
      maxTokens: modelConfig.llm.maxTokens,
    };
  }
  return {
    provider: modelConfig.provider ?? "",
    model: modelConfig.model ?? "",
    connectorId: modelConfig.connectorId ?? null,
  };
}

function normalizeOptionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRequiredText(value: string): string {
  return value.trim();
}

/**
 * Builds a normalized subagent configuration payload for model_config.
 *
 * @param draft - Subagent form input.
 * @returns A backend-ready subagent configuration.
 */
export function buildSubagentConfig(
  draft: ISubagentDraft,
): ISubagentConfig {
  const description = normalizeOptionalText(draft.description);

  return {
    name: normalizeRequiredText(draft.name),
    system_prompt: normalizeRequiredText(draft.systemPrompt),
    ...(description ? { description } : {}),
    ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
    ...(draft.catalogSkillId ? { catalog_skill_id: draft.catalogSkillId } : {}),
  };
}

export interface ITemplateSubagent {
  name: string;
  description: string;
  system_prompt: string;
  enabled: boolean;
}

export interface ITemplate {
  id: string;
  label: string;
  name: string;
  description: string;
  system_prompt: string;
  rules: string;
  soul: string;
  subagents: ITemplateSubagent[];
}

/**
 * Builds the MVP model_config object expected by the agent API.
 *
 * @param draft - Agent form input.
 * @returns A normalized model_config payload.
 */
export function buildAgentModelConfig(
  draft: IAgentDraft,
): IAgentModelConfig {
  return {
    llm: {
      provider: normalizeRequiredText(draft.provider),
      model: normalizeRequiredText(draft.model),
      connectorId: normalizeOptionalText(draft.connectorId) ?? null,
      ...(draft.temperature !== undefined
        ? { temperature: draft.temperature }
        : {}),
      ...(draft.maxTokens !== undefined
        ? { maxTokens: draft.maxTokens }
        : {}),
    },
    rules: normalizeRequiredText(draft.rules),
    soul: normalizeRequiredText(draft.soul),
    subagents: (draft.subagents ?? []).map(buildSubagentConfig),
  };
}

/**
 * Builds a backend-ready create-agent payload from the MVP form values.
 *
 * @param draft - Agent form input.
 * @returns A payload that matches POST /admin/agents.
 */
export function buildCreateAgentPayload(
  draft: IAgentDraft,
): ICreateAgentPayload {
  const description = normalizeOptionalText(draft.description);
  const tools = draft.tools ?? [];
  const channels = draft.channels ?? [];
  const inputVariables = draft.inputVariables ?? [];
  const outputVariables = draft.outputVariables ?? [];
  const knowledgeBaseIds = draft.knowledgeBaseIds ?? [];

  return {
    name: normalizeRequiredText(draft.name),
    ...(description ? { description } : {}),
    system_prompt: normalizeRequiredText(draft.systemPrompt),
    model_config: buildAgentModelConfig(draft),
    ...(tools.length > 0 ? { tools: [...tools] } : {}),
    ...(channels.length > 0 ? { channels: [...channels] } : {}),
    ...(inputVariables.length > 0
      ? { input_variables: inputVariables }
      : {}),
    ...(outputVariables.length > 0
      ? { output_variables: outputVariables }
      : {}),
    ...(knowledgeBaseIds.length > 0
      ? { knowledge_base_ids: knowledgeBaseIds }
      : {}),
  };
}
