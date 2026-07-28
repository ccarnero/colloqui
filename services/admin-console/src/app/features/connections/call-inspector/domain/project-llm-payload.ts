// project-llm-payload.ts — projects a stored `llm_call_completed` payload
// (`manual-loops/connectors/connection-call-inspector.md` T04 field shape:
// `agent-ai-service/src/modules/llm/llm-call-event-publisher.service.ts:75-85`
// — model, provider, prompt, completion, inputTokens, outputTokens,
// cachedInputTokens, costUsd, durationMs) into the call inspector's
// standalone-LLM section (T07). Pure function, no Angular/DOM.

import { asRecord, asScalarString } from "./format-payload-value";

export interface ILlmPayloadProjection {
  readonly model: string | null;
  readonly provider: string | null;
  readonly prompt: string | null;
  readonly completion: string | null;
  readonly inputTokens: string | null;
  readonly outputTokens: string | null;
  readonly costUsd: string | null;
  readonly durationMs: string | null;
}

export function projectLlmPayload(payload: unknown): ILlmPayloadProjection {
  const record = asRecord(payload) ?? {};
  return {
    model: asScalarString(record["model"]),
    provider: asScalarString(record["provider"]),
    prompt: asScalarString(record["prompt"]),
    completion: asScalarString(record["completion"]),
    inputTokens: asScalarString(record["inputTokens"]),
    outputTokens: asScalarString(record["outputTokens"]),
    costUsd: asScalarString(record["costUsd"]),
    durationMs: asScalarString(record["durationMs"]),
  };
}
