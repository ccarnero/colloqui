// parse-node-runs-query.ts — validates + normalizes the raw
// `?correlationIds=a,b,c&actionName=...` query params for `GET /node-runs`
// (IF-editor round-2 task). Reuses the exact correlationIds validation
// `parse-node-stats-query.ts` already established (dedupe, bound at
// MAX_LIST_LIMIT), plus a required, trimmed, non-blank `actionName`.

import { MAX_LIST_LIMIT } from "@yoizen/shared";
import { err, ok, type Result } from "./result.js";

export interface RawNodeRunsQueryInput {
  readonly correlationIds: string | null;
  readonly actionName: string | null;
}

export interface ParsedNodeRunsQuery {
  readonly correlationIds: readonly string[];
  readonly actionName: string;
}

/**
 * Parses+validates `?correlationIds=...&actionName=...` — both REQUIRED.
 * `correlationIds` follows the same dedupe/trim/cap discipline as
 * `parseNodeStatsQuery`; `actionName` is trimmed and rejected if blank
 * (an unfiltered runs list over every action in the definition is not
 * this endpoint's shape — the Runs tab always asks for one node's runs).
 */
export function parseNodeRunsQuery(
  input: RawNodeRunsQueryInput
): Result<ParsedNodeRunsQuery, string> {
  const rawCorrelationIds = input.correlationIds?.trim();
  if (!rawCorrelationIds) {
    return err("missing required 'correlationIds' query parameter");
  }

  const seen = new Set<string>();
  for (const candidate of rawCorrelationIds.split(",")) {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      seen.add(trimmed);
    }
  }

  if (seen.size === 0) {
    return err("'correlationIds' contained no valid ids");
  }

  const actionName = input.actionName?.trim();
  if (!actionName) {
    return err("missing required 'actionName' query parameter");
  }

  const correlationIds = [...seen].slice(0, MAX_LIST_LIMIT);
  return ok({ correlationIds, actionName });
}
