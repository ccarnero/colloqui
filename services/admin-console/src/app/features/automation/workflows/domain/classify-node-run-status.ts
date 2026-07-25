/**
 * Classifies a per-node aggregate's `ok_ratio` (tracking-ingester-service
 * `GET /node-stats`, T07 of console-redesign-builder-v2.md) into the
 * node-card footer's health dot. Not a TAXONOMY.md classification rule —
 * `ok_ratio` is a derived UI-only aggregate, not an event's `tech`/
 * `business_fn` — these thresholds are a T07 presentation decision:
 * `>= 0.98` mirrors the mock's `● ok` dot for a healthy node, `< 0.8` is
 * clearly degraded (`error`), everything between is `warning`.
 */
export function classifyNodeRunStatus(
  okRatio: number | null
): "ok" | "warning" | "error" {
  if (okRatio === null) {
    return "warning";
  }
  if (okRatio >= 0.98) {
    return "ok";
  }
  if (okRatio >= 0.8) {
    return "warning";
  }
  return "error";
}
