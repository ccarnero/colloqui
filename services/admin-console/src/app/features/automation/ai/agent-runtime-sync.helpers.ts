import {
  getAgentLlmConfig,
  type IAgent,
} from "../../../core/models/agent.model";
import type { HealthStatus } from "../../../shared/components/status-badge/status-badge.component";
import type { IAgentRuntimeHealth } from "./existing-agents-panel.component";

/**
 * Pure re-derivation of the per-agent runtime state, mirroring the
 * `checkRuntimeSync` algorithm in `ai.component.ts:1561-1644` (T01 finding
 * 6, `manual-loops/admin-console/console-redesign-ai.md`). That method is a
 * private method of the shared list/editor host component and cannot be
 * imported without touching editor code (out of scope for T02 - "only the
 * list page"), so the exact same branch order and conditions are
 * reproduced here as a standalone pure function for the new list page.
 * Nothing invented: gateway health -> published flag -> provider/model
 * presence, in that exact order, same three failure states + "synced".
 */
export function deriveAgentRuntimeState(
  agent: IAgent,
  gatewayHealthy: boolean
): IAgentRuntimeHealth {
  const llm = getAgentLlmConfig(agent.model_config);
  const isPublished = agent.status === "published";
  const hasProvider = !!llm.provider?.trim();
  const hasModel = !!llm.model?.trim();

  if (!gatewayHealthy) {
    return {
      state: "unsynced",
      detail: "Runtime gateway unavailable",
      checkedAt: Date.now(),
    };
  }

  if (!isPublished) {
    return {
      state: "draft",
      detail: "Agent not published",
      checkedAt: Date.now(),
    };
  }

  if (!hasProvider || !hasModel) {
    const missing = [!hasProvider ? "provider" : "", !hasModel ? "model" : ""]
      .filter(Boolean)
      .join(", ");
    return {
      state: "misconfigured",
      detail: `Missing LLM config: ${missing}`,
      checkedAt: Date.now(),
    };
  }

  return { state: "synced", checkedAt: Date.now() };
}

/**
 * Runtime-state -> health-dot mapping for the T02 InventoryTable, per the
 * mapping decided in the task text itself (SPEC T02): synced -> ok,
 * draft -> idle, unsynced -> warn, misconfigured -> error. These are the
 * four real runtime states T01 found (`checkRuntimeSync`); "checking" and
 * "unknown" are transient/fallback states with no dedicated dot in the
 * design contract, so they fall back to "idle" and log a debug trace so
 * the fallback is never silent.
 */
export function mapRuntimeStateToHealth(
  state: IAgentRuntimeHealth["state"]
): HealthStatus {
  switch (state) {
    case "synced":
      return "ok";
    case "draft":
      return "idle";
    case "unsynced":
      return "warn";
    case "misconfigured":
      return "error";
    default:
      console.debug(
        "[agent-runtime-sync.helpers] unmapped runtime state, defaulting health dot to idle",
        { state }
      );
      return "idle";
  }
}
