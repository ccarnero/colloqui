export const YOIZENCLAW_AGENT_STATUSES = {
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
} as const;

export type YoizenclawAgentStatus =
  (typeof YOIZENCLAW_AGENT_STATUSES)[keyof typeof YOIZENCLAW_AGENT_STATUSES];

export const YOIZENCLAW_CREDENTIAL_TYPES = {
  API_KEY: "api_key",
  OAUTH: "oauth",
  BASIC: "basic",
  CUSTOM: "custom",
} as const;

export type YoizenclawCredentialType =
  (typeof YOIZENCLAW_CREDENTIAL_TYPES)[keyof typeof YOIZENCLAW_CREDENTIAL_TYPES];

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

export interface IYoizenclawCredentialProfile {
  id: string;
  name: string;
  type: YoizenclawCredentialType;
  is_encrypted: boolean;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IYoizenclawCredentialListResponse {
  credentials: IYoizenclawCredentialProfile[];
  total: number;
}

export interface IYoizenclawCredentialListQuery {
  type?: YoizenclawCredentialType;
  is_active?: boolean;
  limit?: number;
  offset?: number;
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
