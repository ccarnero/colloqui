// project-execution-payload.ts — projects a stored `execution_completed`
// payload (`manual-loops/connectors/connection-call-inspector.md` T07 field
// shape: `agent-ai-service/src/nats-handlers/execution.handler.ts:175-292` —
// response, usage{inputTokens,outputTokens,totalTokens}, costUsd, toolCalls,
// toolResults, model, provider) into the call inspector's agent-execution
// section. Pure function, no Angular/DOM.

import { asRecord, asScalarString, formatJson } from "./format-payload-value";

export interface IExecutionPayloadProjection {
  /** The inbound chat message. `execution_completed` does NOT carry the
   * input message today (`execution.handler.ts:175-192` publishes only the
   * response side) — read defensively so a future field addition is picked
   * up without a code change, same "every field optional" convention as
   * `project-http-payload.ts`. `null` when absent. */
  readonly messageIn: string | null;
  readonly replyText: string | null;
  readonly toolCallsJson: string | null;
  readonly toolResultsJson: string | null;
  readonly model: string | null;
  readonly provider: string | null;
  readonly inputTokens: string | null;
  readonly outputTokens: string | null;
  readonly costUsd: string | null;
}

export function projectExecutionPayload(
  payload: unknown
): IExecutionPayloadProjection {
  const record = asRecord(payload) ?? {};
  const usage = asRecord(record["usage"]) ?? {};
  return {
    messageIn: asScalarString(record["message"]),
    replyText: asScalarString(record["response"]),
    toolCallsJson: formatJson(record["toolCalls"]),
    toolResultsJson: formatJson(record["toolResults"]),
    model: asScalarString(record["model"]),
    provider: asScalarString(record["provider"]),
    inputTokens: asScalarString(usage["inputTokens"]),
    outputTokens: asScalarString(usage["outputTokens"]),
    costUsd: asScalarString(record["costUsd"]),
  };
}
