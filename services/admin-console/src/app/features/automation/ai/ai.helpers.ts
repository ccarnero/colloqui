import type {
  IAgentToolDraft,
  IAgentToolPayload,
  ISubagentDraft,
  IToolParameter,
  ToolSourceType,
} from "../../../core/models/agent.model";

/**
 * Normalizes Nest/backend error payloads where `message` may be a string or array.
 */
export function formatHttpErrorMessage(
  message: string | string[] | undefined,
  fallback: string
): string {
  return Array.isArray(message) ? message.join(", ") : (message ?? fallback);
}

// Single source of truth for the mention pattern. Non-greedy name group stops
// at punctuation, a recognized stop word, or end-of-string, so multi-word
// names (with spaces/hyphens) are captured without swallowing surrounding
// prose. Exported so other consumers (e.g. Monaco decorations) reuse the
// EXACT same boundary logic instead of re-implementing it.
export const MENTION_PATTERN_SOURCE =
  "@(skill|tool):([a-zA-Z0-9_ -]+?)(?:\\s+(?:skill|tool|and|or|the|for|when|while|using|with|to)\\s|[,.!?;:\\n]|\\s*$)";

/**
 * Builds a fresh mention regex instance. The pattern uses a global flag, so a
 * shared module-level RegExp would carry mutable `lastIndex` state across
 * calls — always construct a new one per parse.
 */
export function createMentionRegex(): RegExp {
  return new RegExp(MENTION_PATTERN_SOURCE, "gi");
}

export function extractMentionsFromPrompt(text: string): string[] {
  const mentionRegex = createMentionRegex();
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[2].trim();
    if (name) {
      mentions.push(`@${match[1]}:${name}`);
    }
  }

  return [...new Set(mentions)];
}

function buildParametersSchema(
  parameters: IToolParameter[]
): Record<string, unknown> {
  if (!parameters || parameters.length === 0) {
    return {};
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of parameters) {
    if (!param.name.trim()) {
      continue;
    }
    const prop: Record<string, unknown> = { type: param.type };
    if (param.description?.trim()) {
      prop["description"] = param.description.trim();
    }
    if (param.enum && param.enum.length > 0) {
      prop["enum"] = param.enum.filter((e) => e.trim().length > 0);
    }
    properties[param.name.trim()] = prop;
    if (param.required) {
      required.push(param.name.trim());
    }
  }

  const schema: Record<string, unknown> = {
    type: "object",
    properties,
  };
  if (required.length > 0) {
    schema["required"] = required;
  }
  return schema;
}

function parseParametersFromSchema(schema: unknown): IToolParameter[] {
  if (!schema || typeof schema !== "object") {
    return [];
  }
  const s = schema as Record<string, unknown>;
  if (!s["properties"] || typeof s["properties"] !== "object") {
    return [];
  }

  const required = Array.isArray(s["required"])
    ? (s["required"] as string[])
    : [];
  const params: IToolParameter[] = [];

  for (const [name, prop] of Object.entries(
    s["properties"] as Record<string, unknown>
  )) {
    if (!prop || typeof prop !== "object") {
      continue;
    }
    const p = prop as Record<string, unknown>;
    params.push({
      name,
      type: (typeof p["type"] === "string"
        ? p["type"]
        : "string") as IToolParameter["type"],
      description: typeof p["description"] === "string" ? p["description"] : "",
      required: required.includes(name),
      enum: Array.isArray(p["enum"]) ? p["enum"].map(String) : undefined,
    });
  }
  return params;
}

export function parseToolPayload(raw: unknown): IAgentToolDraft {
  const t = raw as Record<string, unknown>;
  const isBuiltin = t["builtin"] === true || t["source_type"] === "builtin";
  const sourceType: ToolSourceType = isBuiltin
    ? "builtin"
    : ((t["source_type"] as ToolSourceType) ?? "http");
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
    parameters: parseParametersFromSchema(t["parameters"]),
  };
}

export function buildToolPayloadsFromDrafts(
  tools: IAgentToolDraft[]
): IAgentToolPayload[] {
  return tools
    .filter((t) => t.name.trim().length > 0)
    .map((t) => {
      const payload: IAgentToolPayload = {
        name: t.name.trim(),
        source_type: t.sourceType,
        ...(t.description ? { description: t.description.trim() } : {}),
      };

      if (t.sourceType === "builtin") {
        payload.builtin = true;
        return payload;
      }

      if (t.sourceType === "http" && t.endpointUrl.trim()) {
        payload.endpoint = {
          url: t.endpointUrl.trim(),
          method: t.endpointMethod,
        };
        if (t.parameters && t.parameters.length > 0) {
          payload.parameters = buildParametersSchema(t.parameters);
        }
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
  catalog_skill_id?: string;
}): ISubagentDraft {
  return {
    name: config.name,
    description: config.description || "",
    systemPrompt: config.system_prompt,
    enabled: config.enabled ?? true,
    ...(config.catalog_skill_id
      ? { catalogSkillId: config.catalog_skill_id }
      : {}),
  };
}
