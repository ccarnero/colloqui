import { describe, expect, it } from "bun:test";
import { toIsoMillis } from "../../src/lib/to-iso-millis.js";

describe("toIsoMillis", () => {
  it("preserves millisecond precision for a Date instance", () => {
    // Regression: Date.parse(date) coerces through Date#toString() (second
    // precision only) — toIsoMillis must route through Date#toISOString()
    // instead, which always retains milliseconds.
    const date = new Date("2026-07-11T15:38:33.726Z");
    expect(toIsoMillis(date)).toBe("2026-07-11T15:38:33.726Z");
  });

  it("preserves millisecond precision for an ISO string", () => {
    expect(toIsoMillis("2026-07-11T15:38:33.838Z")).toBe(
      "2026-07-11T15:38:33.838Z"
    );
  });

  it("normalizes a string lacking milliseconds to the .000 form", () => {
    expect(toIsoMillis("2026-07-11T15:38:33Z")).toBe(
      "2026-07-11T15:38:33.000Z"
    );
  });
});
