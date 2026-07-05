import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type { DashboardStats } from "./types.js";

export interface DashboardClientDeps {
  transport: Transport;
}

export interface DashboardCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface DashboardClient {
  /**
   * `GET /dashboard/stats` — a Redis-cached, gateway-computed aggregate
   * (partially synthetic quota data), not a pure downstream passthrough.
   * See `types.ts`.
   */
  getStats(opts?: DashboardCallOptions): Promise<DashboardStats>;
}

/**
 * Creates the `dashboard` namespace client. Follows the `workflows`
 * reference implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients".
 */
export function createDashboardClient({
  transport,
}: DashboardClientDeps): DashboardClient {
  async function getStats(
    opts: DashboardCallOptions = {}
  ): Promise<DashboardStats> {
    const { body } = await transport.request<DashboardStats>({
      path: "/dashboard/stats",
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  return { getStats };
}
