import { mapDailyBreakdownToUsageRows } from "./analytics-daily-breakdown-to-usage-rows";

describe("mapDailyBreakdownToUsageRows", () => {
  it("maps each daily breakdown entry onto an 'ingress' usage bucket row", () => {
    const rows = mapDailyBreakdownToUsageRows([
      { date: "2026-07-01", requests: 1200, avgLatencyMs: 42 },
      { date: "2026-07-02", requests: 1500, avgLatencyMs: 38 },
    ]);

    expect(rows).toEqual([
      {
        bucket: "2026-07-01",
        accountId: "tenant-aggregate",
        channel: "tenant-aggregate",
        direction: "ingress",
        events: 1200,
      },
      {
        bucket: "2026-07-02",
        accountId: "tenant-aggregate",
        channel: "tenant-aggregate",
        direction: "ingress",
        events: 1500,
      },
    ]);
  });

  it("returns an empty array for an empty breakdown, without throwing", () => {
    expect(mapDailyBreakdownToUsageRows([])).toEqual([]);
  });

  it("preserves the requests count verbatim as events (no invented scaling)", () => {
    const rows = mapDailyBreakdownToUsageRows([
      { date: "2026-07-03", requests: 0, avgLatencyMs: 0 },
    ]);
    expect(rows[0]?.events).toBe(0);
  });
});
