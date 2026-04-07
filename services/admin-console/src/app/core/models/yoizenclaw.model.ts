// ---------------------------------------------------------------------------
// Tool source types and adapter reference
// ---------------------------------------------------------------------------

/** Discriminator for how a tool reaches its backend. */
export type ToolSourceType = "http" | "adapter";

/** Reference to an adapter and one of its endpoints. */
export interface IToolAdapterRef {
  adapterId: string;
  endpointId: string;
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
}

/** Backend tool payload sent to the API. */
export interface IAgentToolPayload {
  name: string;
  description?: string;
  source_type: ToolSourceType;
  endpoint?: { url: string; method: string };
  adapter_ref?: { adapter_id: string; endpoint_id: string };
}

// ---------------------------------------------------------------------------
// Agent statuses
// ---------------------------------------------------------------------------

export const YOIZENCLAW_AGENT_STATUSES = {
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
} as const;

export type YoizenclawAgentStatus =
  (typeof YOIZENCLAW_AGENT_STATUSES)[keyof typeof YOIZENCLAW_AGENT_STATUSES];

export interface IYoizenclawSubagentConfig {
  name: string;
  system_prompt: string;
  description?: string;
  enabled?: boolean;
}

export interface IYoizenclawAgentModelConfigLlm {
  provider: string;
  model: string;
  connectorId: string | null;
}

export interface IYoizenclawAgentModelConfig {
  llm: IYoizenclawAgentModelConfigLlm;
  rules: string;
  soul: string;
  subagents: IYoizenclawSubagentConfig[];
}

export interface IYoizenclawAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_config: IYoizenclawAgentModelConfig;
  tools: unknown[];
  channels: unknown[];
  status: YoizenclawAgentStatus;
  is_active: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IYoizenclawAgentListResponse {
  agents: IYoizenclawAgent[];
  total: number;
}

export interface IYoizenclawAgentListQuery {
  status?: YoizenclawAgentStatus;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface IYoizenclawChatContextEntry {
  sender: "customer" | "agent";
  content: string;
}

export interface IYoizenclawChatRequest {
  message: string;
  conversationId: string;
  channel?: string;
  customerName?: string;
  userId?: string;
  context: IYoizenclawChatContextEntry[];
}

export interface IYoizenclawChatResponse {
  reply: string;
  tool_calls: unknown[];
}

export interface IYoizenclawMemoryProposal {
  id: string;
  kind?: string;
  title?: string;
  content_excerpt?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface IYoizenclawMemoryProposalListResponse {
  proposals: IYoizenclawMemoryProposal[];
}

export interface IYoizenclawMemoryProposalActionResponse {
  success: boolean;
  proposal?: IYoizenclawMemoryProposal;
}

export interface IYoizenclawSubagentDraft {
  name: string;
  systemPrompt: string;
  description?: string;
  enabled?: boolean;
}

export interface IYoizenclawAgentDraft {
  name: string;
  description?: string;
  systemPrompt: string;
  provider: string;
  model: string;
  connectorId?: string | null;
  rules: string;
  soul: string;
  subagents?: IYoizenclawSubagentDraft[];
  tools?: readonly unknown[];
  channels?: readonly unknown[];
}

export interface IYoizenclawCreateAgentPayload {
  name: string;
  description?: string;
  system_prompt: string;
  model_config: IYoizenclawAgentModelConfig;
  tools?: unknown[];
  channels?: unknown[];
}

export function getAgentLlmConfig(modelConfig: IYoizenclawAgentModelConfig): {
  provider: string;
  model: string;
  connectorId: string | null;
} {
  return {
    provider: modelConfig.llm.provider,
    model: modelConfig.llm.model,
    connectorId: modelConfig.llm.connectorId,
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
export function buildYoizenclawSubagentConfig(
  draft: IYoizenclawSubagentDraft,
): IYoizenclawSubagentConfig {
  const description = normalizeOptionalText(draft.description);

  return {
    name: normalizeRequiredText(draft.name),
    system_prompt: normalizeRequiredText(draft.systemPrompt),
    ...(description ? { description } : {}),
    ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
  };
}

export interface IYoizenclawTemplateSubagent {
  name: string;
  description: string;
  system_prompt: string;
  enabled: boolean;
}

export interface IYoizenclawTemplate {
  id: string;
  label: string;
  name: string;
  description: string;
  system_prompt: string;
  rules: string;
  soul: string;
  subagents: IYoizenclawTemplateSubagent[];
}

/**
 * Builds the MVP model_config object expected by the agent API.
 *
 * @param draft - Agent form input.
 * @returns A normalized model_config payload.
 */
export function buildYoizenclawAgentModelConfig(
  draft: IYoizenclawAgentDraft,
): IYoizenclawAgentModelConfig {
  return {
    llm: {
      provider: normalizeRequiredText(draft.provider),
      model: normalizeRequiredText(draft.model),
      connectorId: normalizeOptionalText(draft.connectorId) ?? null,
    },
    rules: normalizeRequiredText(draft.rules),
    soul: normalizeRequiredText(draft.soul),
    subagents: (draft.subagents ?? []).map(buildYoizenclawSubagentConfig),
  };
}

/**
 * Builds a backend-ready create-agent payload from the MVP form values.
 *
 * @param draft - Agent form input.
 * @returns A payload that matches POST /admin/agents.
 */
export function buildYoizenclawCreateAgentPayload(
  draft: IYoizenclawAgentDraft,
): IYoizenclawCreateAgentPayload {
  const description = normalizeOptionalText(draft.description);
  const tools = draft.tools ?? [];
  const channels = draft.channels ?? [];

  return {
    name: normalizeRequiredText(draft.name),
    ...(description ? { description } : {}),
    system_prompt: normalizeRequiredText(draft.systemPrompt),
    model_config: buildYoizenclawAgentModelConfig(draft),
    ...(tools.length > 0 ? { tools: [...tools] } : {}),
    ...(channels.length > 0 ? { channels: [...channels] } : {}),
  };
}
