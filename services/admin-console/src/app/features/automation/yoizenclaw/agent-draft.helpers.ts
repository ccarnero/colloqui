import type {
  IYoizenclawAgent,
  IYoizenclawAgentDraft,
  IYoizenclawSubagentDraft,
} from "../../../core/models/yoizenclaw.model";
import { getAgentLlmConfig } from "../../../core/models/yoizenclaw.model";
import { mapSubagentConfigToDraft, parseToolPayload } from "./yoizenclaw.helpers";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = (message: string): Err => ({ ok: false, error: message });

// ---------------------------------------------------------------------------
// Draft snapshot (persisted shape)
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "yoizenclaw:agent-draft:";
// Bump this when the IYoizenclawAgentDraft shape or comparison logic changes —
// older drafts in localStorage are silently dropped on next load instead of
// triggering a phantom "Restored unsaved changes" banner.
const SNAPSHOT_VERSION = 2;
const NEW_AGENT_KEY = "__new__";

export interface IAgentDraftSnapshot {
  version: number;
  agentId: string;
  draft: IYoizenclawAgentDraft;
  savedAt: number;
}

function buildStorageKey(agentId: string | null): string {
  const id = agentId && agentId.trim().length > 0 ? agentId : NEW_AGENT_KEY;
  return `${STORAGE_PREFIX}${id}`;
}

// ---------------------------------------------------------------------------
// Public API — save / load / clear / has
// ---------------------------------------------------------------------------

export function saveAgentDraft(
  agentId: string | null,
  draft: IYoizenclawAgentDraft,
): Result<IAgentDraftSnapshot> {
  const key = buildStorageKey(agentId);
  const snapshot: IAgentDraftSnapshot = {
    version: SNAPSHOT_VERSION,
    agentId: agentId ?? NEW_AGENT_KEY,
    draft,
    savedAt: Date.now(),
  };

  try {
    const serialized = JSON.stringify(snapshot);
    window.localStorage.setItem(key, serialized);
    console.debug("[agent-draft] saved", { key, size: serialized.length });
    return ok(snapshot);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.warn("[agent-draft] save failed", { key, message });
    return err(`Could not save draft: ${message}`);
  }
}

export function loadAgentDraft(
  agentId: string | null,
): Result<IAgentDraftSnapshot | null> {
  const key = buildStorageKey(agentId);

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      console.debug("[agent-draft] no draft to load", { key });
      return ok(null);
    }

    const parsed = JSON.parse(raw) as IAgentDraftSnapshot;
    if (parsed.version !== SNAPSHOT_VERSION) {
      console.warn("[agent-draft] discarding mismatched draft version", {
        key,
        expected: SNAPSHOT_VERSION,
        got: parsed.version,
      });
      window.localStorage.removeItem(key);
      return ok(null);
    }

    console.debug("[agent-draft] loaded", { key, savedAt: parsed.savedAt });
    return ok(parsed);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.warn("[agent-draft] load failed", { key, message });
    return err(`Could not load draft: ${message}`);
  }
}

export function clearAgentDraft(agentId: string | null): Result<void> {
  const key = buildStorageKey(agentId);
  try {
    window.localStorage.removeItem(key);
    console.debug("[agent-draft] cleared", { key });
    return ok(undefined);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.warn("[agent-draft] clear failed", { key, message });
    return err(`Could not clear draft: ${message}`);
  }
}

export function hasAgentDraft(agentId: string | null): boolean {
  const key = buildStorageKey(agentId);
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mapping — backend agent → draft (for compare-against-saved)
// ---------------------------------------------------------------------------

export function buildDraftFromAgent(
  agent: IYoizenclawAgent,
): IYoizenclawAgentDraft {
  const llm = getAgentLlmConfig(agent.model_config);
  const subagents: IYoizenclawSubagentDraft[] =
    agent.model_config.subagents.map(mapSubagentConfigToDraft);
  const tools = (agent.tools ?? []).map((raw) => parseToolPayload(raw));

  return {
    name: agent.name,
    description: agent.description ?? "",
    systemPrompt: agent.system_prompt,
    provider: llm.provider,
    model: llm.model,
    connectorId: llm.connectorId,
    rules: agent.model_config.rules,
    soul: agent.model_config.soul,
    subagents,
    tools,
  };
}

// ---------------------------------------------------------------------------
// Equality — used to compute isDirty without reference checks
// ---------------------------------------------------------------------------

export function areDraftsEqual(
  a: IYoizenclawAgentDraft,
  b: IYoizenclawAgentDraft,
): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (cause) {
    console.warn("[agent-draft] equality check failed, assuming dirty", cause);
    return false;
  }
}
