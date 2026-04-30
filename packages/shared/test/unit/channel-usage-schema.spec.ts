import { describe, expect, it } from "bun:test";
import { CHANNEL_USAGE_SCHEMA_SQL } from "../../src/channel-usage-schema";

describe("CHANNEL_USAGE_SCHEMA_SQL", () => {
  it("enables real-time reads for channel usage continuous aggregates", () => {
    expect(CHANNEL_USAGE_SCHEMA_SQL).toContain(
      "ALTER MATERIALIZED VIEW channel_events_hourly",
    );
    expect(CHANNEL_USAGE_SCHEMA_SQL).toContain(
      "ALTER MATERIALIZED VIEW channel_events_daily",
    );
    expect(CHANNEL_USAGE_SCHEMA_SQL).toContain(
      "SET (timescaledb.materialized_only = false)",
    );
  });
});
