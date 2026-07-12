// Pure route-matching helper for `GET /runs/:workflowId/:runId` (T01 of
// manual-loops/run-view.md). Mirrors match-chain-route.ts exactly —
// extracted from src/main.ts so the path pattern is unit-testable without a
// running `Bun.serve` instance. No DB/HTTP work happens here, just string
// parsing.

export interface RunRouteMatch {
  readonly workflowId: string;
  readonly runId: string;
}

const RUN_ROUTE_PATTERN = /^\/runs\/([^/]+)\/([^/]+)\/?$/;

/**
 * Matches `pathname` against `/runs/:workflowId/:runId`. Returns `null` for
 * any non-matching path (including `/runs`, `/runs/:workflowId` with no run
 * id, or nested segments). Both captured ids are URL-decoded so ids
 * containing encoded characters round-trip correctly.
 */
export function matchRunRoute(pathname: string): RunRouteMatch | null {
  const match = RUN_ROUTE_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }
  const rawWorkflowId = match[1]!;
  const rawRunId = match[2]!;
  const workflowId = decodeURIComponent(rawWorkflowId);
  const runId = decodeURIComponent(rawRunId);
  if (workflowId.length === 0 || runId.length === 0) {
    return null;
  }
  return { workflowId, runId };
}
