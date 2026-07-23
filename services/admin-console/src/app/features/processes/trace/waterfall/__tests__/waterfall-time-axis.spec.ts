import { describe, expect, it } from "vitest";
import { computeTimeAxisTicks } from "../waterfall-time-axis";

describe("computeTimeAxisTicks", () => {
  it("returns 5 ticks at 0/25/50/75/100 percent, ms values scaled off total_ms", () => {
    const ticks = computeTimeAxisTicks(1236);
    expect(ticks).toEqual([
      { percent: 0, ms: 0 },
      { percent: 25, ms: 309 },
      { percent: 50, ms: 618 },
      { percent: 75, ms: 927 },
      { percent: 100, ms: 1236 },
    ]);
  });

  it("returns all-zero ticks for a zero total_ms chain (no NaN/negative values)", () => {
    const ticks = computeTimeAxisTicks(0);
    expect(ticks.every((t) => t.ms === 0)).toBe(true);
  });

  it("treats a negative total_ms as zero — defensive, never negative labels", () => {
    const ticks = computeTimeAxisTicks(-100);
    expect(ticks.every((t) => t.ms === 0)).toBe(true);
  });
});
