import type { IUsageBucketRow } from "../../../core/models/channel-streams.model";
import type { IDashboardDailyBreakdown } from "../../../core/services/dashboard.service";

/**
 * Placeholder scope values for the two `IUsageBucketRow` fields that
 * `UsageChartComponent` requires but never reads for rendering (only
 * `bucket`/`direction`/`events` drive the chart model, see
 * `usage-chart.component.ts:219-270`). `DashboardService.stats().dailyBreakdown`
 * is tenant-wide (not scoped to a single account/channel), so these are
 * documented sentinel values rather than invented per-account/channel data.
 */
const AGGREGATE_ACCOUNT_ID = "tenant-aggregate";
const AGGREGATE_CHANNEL = "tenant-aggregate";

/**
 * Adapts `DashboardService`'s real `dailyBreakdown` series (T01 finding 2:
 * the same source L1 Dashboard uses for `apiUsageData`) into
 * `UsageChartComponent`'s `IUsageBucketRow[]` input shape, so the Analytics
 * chart can reuse the existing multi-series SVG area+line chart (SPEC
 * `console-redesign-users-analytics-settings.md` decision 3, RESOLVED
 * 2026-07-23) without modifying `UsageChartComponent` itself (cross-section
 * diff = auto-reject).
 *
 * Only one real daily series exists (`requests`) — there is no in/out or
 * ingress/egress split for dashboard requests, so it is mapped onto the
 * "ingress" direction only. "egress" and "dlq" are intentionally never
 * emitted: decision 2 amendment (a) forbids inventing metrics, so the chart
 * renders those two legend entries as flat, dataless series (a documented,
 * accepted cosmetic side effect of reusing the component unmodified).
 */
export function mapDailyBreakdownToUsageRows(
  breakdown: ReadonlyArray<IDashboardDailyBreakdown>
): IUsageBucketRow[] {
  if (breakdown.length === 0) {
    // Verbose logging: an empty daily breakdown must not fail silently —
    // the caller renders the chart's own "No usage data" empty state.
    console.debug(
      "[mapDailyBreakdownToUsageRows] empty dailyBreakdown, returning no rows"
    );
    return [];
  }

  return breakdown.map((day) => ({
    bucket: day.date,
    accountId: AGGREGATE_ACCOUNT_ID,
    channel: AGGREGATE_CHANNEL,
    direction: "ingress",
    events: day.requests,
  }));
}
