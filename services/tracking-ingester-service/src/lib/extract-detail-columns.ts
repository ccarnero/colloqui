// Extracts the click-through detail columns added in T4 of
// .sdd/changes/trace-visualization/tasks.md — `workflow_id`, `run_id` for
// workflow-execution events (TAXONOMY.md §4 rule 19) and `connector_id`,
// `cache_status` for connector-invocation events (rule 11). Pure function,
// never throws: any unexpected payload shape (null, non-object, wrong types)
// simply yields all-null columns instead of raising.
//
// Field-name provenance (verified against the actual publishers, not guessed):
//   - Workflow: `execution-completed-publisher.activity.ts` currently emits
//     ONLY `{ executionId, status, workflowName? }` — the real Temporal
//     `workflowId`/`runId` are NOT on the bus event today. This extractor
//     still checks for `workflowId`/`runId` first (forward-compatible with a
//     future publisher change) and falls back to `executionId` as the best
//     available identifier for `workflow_id`, so today's rows are never
//     all-null for a workflow-execution event. Documented gap (apply-progress
//     / T6 risk): the Temporal-UI deep link needs a REAL `workflowId`+`runId`
//     pair, which is not populated by the current publisher — see T6/T9.
//   - Connector: `event-publisher.ts` (connector-runtime) emits
//     `{ adapterId, endpointId, cacheResult, cacheKey?, ... }`. `cacheResult`
//     is `"hit" | "miss" | "bypass" | null` (http-call-with-retry.ts
//     `EndpointCacheResult`).

export interface DetailColumns {
  workflow_id: string | null;
  run_id: string | null;
  connector_id: string | null;
  cache_status: string | null;
}

const NULL_COLUMNS: DetailColumns = {
  workflow_id: null,
  run_id: null,
  connector_id: null,
  cache_status: null,
};

/** TAXONOMY.md §4 rule 19 — workflow-service execution lifecycle. */
const WORKFLOW_EXECUTION_RULE = 19;
/** TAXONOMY.md §4 rule 11 — connector-runtime endpoint invocation. */
const CONNECTOR_INVOCATION_RULE = 11;

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Extracts `{workflow_id, run_id, connector_id, cache_status}` from a
 * classified event's raw envelope payload (`envelope.data.payload`).
 *
 * @param rule the TAXONOMY.md §4 rule that classified this event
 * @param payload `envelope.data.payload` (or any raw body) — untyped by design
 */
export function extractDetailColumns(
  rule: number,
  payload: unknown
): DetailColumns {
  const record = asRecord(payload);
  if (!record) {
    return { ...NULL_COLUMNS };
  }

  if (rule === WORKFLOW_EXECUTION_RULE) {
    return {
      ...NULL_COLUMNS,
      workflow_id: asString(record.workflowId) ?? asString(record.executionId),
      run_id: asString(record.runId),
    };
  }

  if (rule === CONNECTOR_INVOCATION_RULE) {
    return {
      ...NULL_COLUMNS,
      connector_id: asString(record.adapterId) ?? asString(record.endpointId),
      cache_status: asString(record.cacheResult),
    };
  }

  return { ...NULL_COLUMNS };
}
