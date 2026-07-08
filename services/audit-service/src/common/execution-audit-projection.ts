import type { Document } from "mongodb";

/**
 * Shape of `envelope.data.payload` for `execution_started/completed/failed`
 * lifecycle events (DOCS/cowork/METERING-FOUNDATION.md G1/G2). Published by
 * `agent-ai-service`'s `ExecutionHandler.publishStatus` — wider than the
 * declared `YoizenClawExecutionStatus` union (runtime emits `state: "started"`,
 * which is not part of that type, plus `usage`/`costUsd`/`model`/`provider`/
 * `error`/`reason` fields not modeled there either). Defined locally rather
 * than importing the mismatched shared type.
 */
export interface IExecutionLifecyclePayload {
  executionId: string;
  agentId?: string;
  tenantId?: string;
  state: "started" | "completed" | "failed" | string;
  response?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
  };
  costUsd?: number;
  model?: string;
  provider?: string;
  error?: string;
  reason?: string;
}

/**
 * Shared SELECT list for `execution_events` row mapping (camelCase aliases).
 * Used by Postgres list and single-row queries to avoid drift.
 */
export const EXECUTION_AUDIT_SELECT_PROJECTION = `
  id,
  tenant_id            AS "tenantId",
  execution_id         AS "executionId",
  event_kind           AS "eventKind",
  agent_id             AS "agentId",
  conversation_id      AS "conversationId",
  model,
  provider,
  input_tokens         AS "inputTokens",
  output_tokens        AS "outputTokens",
  cached_input_tokens  AS "cachedInputTokens",
  cost_usd             AS "costUsd",
  status,
  error,
  correlation_id       AS "correlationId",
  causation_id         AS "causationId",
  depth,
  occurred_at          AS "occurredAt",
  created_at           AS "createdAt"
`.trim();

export interface IStoredExecutionEvent {
  id: string;
  tenantId: string;
  executionId: string;
  eventKind: string;
  agentId: string | null;
  conversationId: string | null;
  model: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  status: string | null;
  error: string | null;
  correlationId: string | null;
  causationId: string | null;
  depth: number | null;
  occurredAt: string;
  createdAt: string;
}

function readDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return new Date().toISOString();
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Maps a Mongo `execution_events` audit document to the HTTP response shape.
 */
export function mapExecutionAuditDoc(doc: Document): IStoredExecutionEvent {
  return {
    id: String(doc._id ?? doc.id ?? ""),
    tenantId: String(doc.tenant_id ?? ""),
    executionId: String(doc.execution_id ?? ""),
    eventKind: String(doc.event_kind ?? ""),
    agentId: (doc.agent_id as string | null | undefined) ?? null,
    conversationId: (doc.conversation_id as string | null | undefined) ?? null,
    model: (doc.model as string | null | undefined) ?? null,
    provider: (doc.provider as string | null | undefined) ?? null,
    inputTokens: readNumber(doc.input_tokens),
    outputTokens: readNumber(doc.output_tokens),
    cachedInputTokens: readNumber(doc.cached_input_tokens),
    costUsd: readNumber(doc.cost_usd),
    status: (doc.status as string | null | undefined) ?? null,
    error: (doc.error as string | null | undefined) ?? null,
    correlationId: (doc.correlation_id as string | null | undefined) ?? null,
    causationId: (doc.causation_id as string | null | undefined) ?? null,
    depth: typeof doc.depth === "number" ? doc.depth : null,
    occurredAt: readDate(doc.occurred_at),
    createdAt: readDate(doc.created_at),
  };
}
