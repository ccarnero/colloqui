const RUNS_SEGMENT = "runs/";

/**
 * Extracts and decodes the `workflowId`/`runId` pair from a request URL
 * whose path ends in `runs/<workflowId>/<runId>`. Used by
 * `TrackingController#getRun` via a wildcard route (`runs/*`) instead of
 * NestJS's named `:workflowId`/`:runId` segment params, because the
 * deployed gateway's router does not match colon-bearing segments against
 * named params — verified live: `/runs/foo/bar` matched, but real
 * Temporal ids (`acme:e2e-http-agent:sha256:<digest>:<suffix>`) returned
 * Nest's route-not-found 404 on the named-param route.
 *
 * @param url  The raw request URL (may include a query string).
 * @returns Decoded `{ workflowId, runId }` when the path has exactly two
 *   non-empty segments after `runs/`, otherwise `null`.
 */
export function parseRunPathSegments(
  url: string
): { workflowId: string; runId: string } | null {
  const withoutQuery = url.split("?")[0];
  const runsIndex = withoutQuery.indexOf(RUNS_SEGMENT);
  if (runsIndex === -1) {
    return null;
  }

  const suffix = withoutQuery.slice(runsIndex + RUNS_SEGMENT.length);
  const segments = suffix.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2) {
    return null;
  }

  try {
    const [workflowId, runId] = segments;
    return {
      workflowId: decodeURIComponent(workflowId),
      runId: decodeURIComponent(runId),
    };
  } catch {
    return null;
  }
}
