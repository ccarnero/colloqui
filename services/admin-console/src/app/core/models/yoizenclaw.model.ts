// ---------------------------------------------------------------------------
// Provider-aware credential types for YoizenClaw
// ---------------------------------------------------------------------------

/** Supported LLM providers for credentials */
export type YoizenclawCredentialProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "google-vertex"
  | "bedrock"
  | "groq"
  | "mistral"
  | "openrouter"
  | "xai"
  | "cohere"
  | "cerebras"
  | "huggingface"
  | "mock";

/** All supported providers as array */
export const YOIZENCLAW_CREDENTIAL_PROVIDERS: YoizenclawCredentialProvider[] = [
  "openai",
  "anthropic",
  "google",
  "google-vertex",
  "bedrock",
  "groq",
  "mistral",
  "openrouter",
  "xai",
  "cohere",
  "cerebras",
  "huggingface",
  "mock",
];

/** Human-readable provider names */
export const YOIZENCLAW_PROVIDER_DISPLAY_NAMES: Record<YoizenclawCredentialProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI (Gemini)",
  "google-vertex": "Google Vertex AI",
  bedrock: "AWS Bedrock",
  groq: "Groq",
  mistral: "Mistral AI",
  openrouter: "OpenRouter",
  xai: "xAI (Grok)",
  cohere: "Cohere",
  cerebras: "Cerebras",
  huggingface: "Hugging Face",
  mock: "Mock Provider",
};

/** Sync status for credentials */
export type YoizenclawCredentialSyncStatus =
  | "pending"
  | "synced"
  | "failed"
  | "manual_review_required";

/** Provider field definition for dynamic form rendering */
export interface IYoizenclawProviderField {
  name: string;
  type: "string" | "url" | "enum" | "json";
  required: boolean;
  secret: boolean;
  description: string;
  placeholder?: string;
  options?: string[];
}

/** Provider schema definition */
export interface IYoizenclawProviderSchema {
  provider: YoizenclawCredentialProvider;
  display_name: string;
  description: string;
  fields: IYoizenclawProviderField[];
}

/** Provider-aware credential profile */
export interface IYoizenclawCredentialProfile {
  id: string;
  name: string;
  provider: YoizenclawCredentialProvider;
  schema_version: number;
  payload: Record<string, unknown>;
  is_encrypted: boolean;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  is_active: boolean;
  sync_status: YoizenclawCredentialSyncStatus;
  last_sync_at: string | null;
  sync_error: string | null;
  has_secret: boolean;
  created_at: string;
  updated_at: string;

}

/** List response for credentials */
export interface IYoizenclawCredentialListResponse {
  credentials: IYoizenclawCredentialProfile[];
  total: number;
}

/** Query parameters for credential list */
export interface IYoizenclawCredentialListQuery {
  provider?: YoizenclawCredentialProvider;
  sync_status?: YoizenclawCredentialSyncStatus;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

/** Create credential payload (provider-aware) */
export interface IYoizenclawCreateCredentialPayload {
  name: string;
  provider: YoizenclawCredentialProvider;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expires_at?: string;
  is_active?: boolean;
}

/** Update credential payload (provider-aware) */
export interface IYoizenclawUpdateCredentialPayload {
  name?: string;
  provider?: YoizenclawCredentialProvider;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expires_at?: string | null;
  is_active?: boolean;
}

/** Rotate credential payload (provider-aware) */
export interface IYoizenclawRotateCredentialPayload {
  payload: Record<string, unknown>;
  new_expires_at?: string;
}

/** Sync response */
export interface IYoizenclawCredentialSyncResponse {
  message: string;
  triggered: boolean;
  results: { credentialId: string; success: boolean; error?: string }[];
  summary: { successful: number; failed: number; total: number };
}

/** Providers list response */
export interface IYoizenclawProvidersResponse {
  providers: IYoizenclawProviderSchema[];
}

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

export interface IYoizenclawAgentModelConfig {
  provider: string;
  model: string;
  credential_profile_id: string | null;
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
  credentialProfileId?: string | null;
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
    provider: normalizeRequiredText(draft.provider),
    model: normalizeRequiredText(draft.model),
    credential_profile_id: normalizeOptionalText(draft.credentialProfileId) ?? null,
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
