import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createDashboardClient } from "../../../src/resources/dashboard/client.js";

interface Call extends TransportRequestOptions {}

function fakeTransport(
  handler: (
    call: Call
  ) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>
): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = {
    async request(options) {
      calls.push(options);
      return (await handler(options)) as TransportResponse<never>;
    },
  };
  return { transport, calls };
}

const sampleStats = {
  requestsToday: 100,
  requestsTodayDelta: 5,
  activeSessions: 3,
  avgResponseMs: 120,
  avgResponseDelta: -2,
  errorRate: 0.01,
  errorRateDelta: 0,
  dailyBreakdown: [{ date: "2026-07-04", requests: 100, avgLatencyMs: 120 }],
  uptime: 99.9,
  p95ResponseMs: 300,
  quotaApiCalls: { used: 100, limit: 100_000 },
  quotaStorage: { used: 0, limit: 100 },
  quotaWebhooks: { used: 0, limit: 20 },
  recentActivity: [],
  serviceHealth: { "api-gateway": "ok" as const },
};

test("getStats() GETs /dashboard/stats", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleStats,
  }));
  const client = createDashboardClient({ transport });

  const result = await client.getStats();
  assert.equal(calls[0]!.path, "/dashboard/stats");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleStats);
});
