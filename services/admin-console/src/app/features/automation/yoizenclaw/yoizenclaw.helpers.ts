import type {
  IAgentToolDraft,
  IAgentToolPayload,
  IYoizenclawSubagentDraft,
  ToolSourceType,
} from "../../../core/models/yoizenclaw.model";

/**
 * Normalizes Nest/backend error payloads where `message` may be a string or array.
 */
export function formatHttpErrorMessage(
  message: string | string[] | undefined,
  fallback: string,
): string {
  return Array.isArray(message) ? message.join(", ") : (message ?? fallback);
}

export function extractMentionsFromPrompt(text: string): string[] {
  const mentionRegex = /@(skill|tool):([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(`@${match[1]}:${match[2]}`);
  }

  return [...new Set(mentions)];
}

export function parseToolPayload(raw: unknown): IAgentToolDraft {
  const t = raw as Record<string, unknown>;
  const sourceType = (t["source_type"] as ToolSourceType) ?? "http";
  const adapterRef = t["adapter_ref"] as
    | { adapter_id: string; endpoint_id: string }
    | undefined;
  const endpoint = t["endpoint"] as { url: string; method: string } | undefined;

  return {
    name: (t["name"] as string) ?? "",
    description: t["description"] as string | undefined,
    sourceType,
    endpointUrl: endpoint?.url ?? "",
    endpointMethod: endpoint?.method ?? "GET",
    adapterRef: adapterRef
      ? { adapterId: adapterRef.adapter_id, endpointId: adapterRef.endpoint_id }
      : null,
  };
}

export function buildToolPayloadsFromDrafts(
  tools: IAgentToolDraft[],
): IAgentToolPayload[] {
  return tools
    .filter((t) => t.name.trim().length > 0)
    .map((t) => {
      const payload: IAgentToolPayload = {
        name: t.name.trim(),
        source_type: t.sourceType,
        ...(t.description ? { description: t.description.trim() } : {}),
      };

      if (t.sourceType === "http" && t.endpointUrl.trim()) {
        payload.endpoint = {
          url: t.endpointUrl.trim(),
          method: t.endpointMethod,
        };
      }

      if (t.sourceType === "adapter" && t.adapterRef) {
        payload.adapter_ref = {
          adapter_id: t.adapterRef.adapterId,
          endpoint_id: t.adapterRef.endpointId,
        };
      }

      return payload;
    });
}

/**
 * Maps a backend subagent config (snake_case) to a client-side draft (camelCase).
 * Works for both agent model_config subagents and template subagents.
 */
export function mapSubagentConfigToDraft(config: {
  name: string;
  description?: string;
  system_prompt: string;
  enabled?: boolean;
}): IYoizenclawSubagentDraft {
  return {
    name: config.name,
    description: config.description || "",
    systemPrompt: config.system_prompt,
    enabled: config.enabled ?? true,
  };
}
