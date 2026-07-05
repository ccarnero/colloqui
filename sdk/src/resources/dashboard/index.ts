/**
 * `@yoizen/platform-sdk/dashboard` — the `dashboard` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  DashboardCallOptions,
  DashboardClient,
  DashboardClientDeps,
} from "./client.js";
export { createDashboardClient } from "./client.js";
export type {
  DashboardActivity,
  DashboardDailyBreakdown,
  DashboardQuota,
  DashboardStats,
} from "./types.js";
