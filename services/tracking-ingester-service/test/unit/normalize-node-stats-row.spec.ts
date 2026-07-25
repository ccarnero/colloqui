import { describe, expect, it } from "bun:test";
import { normalizeNodeStatsRow } from "../../src/lib/normalize-node-stats-row.js";

describe("normalizeNodeStatsRow", () => {
  it("passes numeric fields through when they already arrive as numbers", () => {
    const row = normalizeNodeStatsRow({
      action_name: "Fetch user",
      branch: null,
      runs: 12,
      p95_ms: 620.4,
      ok_ratio: 0.98,
    });
    expect(row).toEqual({
      action_name: "Fetch user",
      branch: null,
      runs: 12,
      p95_ms: 620.4,
      ok_ratio: 0.98,
    });
  });

  it("coerces driver-string numerics to numbers", () => {
    const row = normalizeNodeStatsRow({
      action_name: "Fetch user",
      branch: "pathA",
      runs: "5",
      p95_ms: "410.1",
      ok_ratio: "1",
    });
    expect(row.runs).toBe(5);
    expect(row.p95_ms).toBe(410.1);
    expect(row.ok_ratio).toBe(1);
  });

  it("degrades a malformed numeric to null instead of NaN", () => {
    const row = normalizeNodeStatsRow({
      action_name: "Fetch user",
      branch: null,
      runs: 3,
      p95_ms: "not-a-number",
      ok_ratio: null,
    });
    expect(row.p95_ms).toBeNull();
    expect(row.ok_ratio).toBeNull();
  });

  it("defaults a malformed runs value to 0 rather than NaN", () => {
    const row = normalizeNodeStatsRow({
      action_name: "Fetch user",
      branch: null,
      runs: "garbage",
      p95_ms: null,
      ok_ratio: null,
    });
    expect(row.runs).toBe(0);
  });
});
