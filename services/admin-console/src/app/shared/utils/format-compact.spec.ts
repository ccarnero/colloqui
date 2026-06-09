import { describe, it, expect } from "vitest";
import { formatCompact } from "./format-compact";

describe("formatCompact", () => {
  it("returns plain number string for values under 1,000", () => {
    expect(formatCompact(1)).toBe("1");
    expect(formatCompact(500)).toBe("500");
    expect(formatCompact(999)).toBe("999");
  });

  it("formats values >= 1,000 with K suffix and 1 decimal", () => {
    expect(formatCompact(1_000)).toBe("1.0K");
    expect(formatCompact(1_234)).toBe("1.2K");
    expect(formatCompact(10_000)).toBe("10.0K");
    expect(formatCompact(999_999)).toBe("1000.0K");
  });

  it("formats values >= 1,000,000 with M suffix and 1 decimal", () => {
    expect(formatCompact(1_000_000)).toBe("1.0M");
    expect(formatCompact(1_500_000)).toBe("1.5M");
    expect(formatCompact(10_000_000)).toBe("10.0M");
    expect(formatCompact(1_234_567)).toBe("1.2M");
  });

  it("returns '0' for zero", () => {
    expect(formatCompact(0)).toBe("0");
  });

  it("handles negative numbers with sign prefix", () => {
    expect(formatCompact(-500)).toBe("-500");
    expect(formatCompact(-1_234)).toBe("-1.2K");
    expect(formatCompact(-1_500_000)).toBe("-1.5M");
  });

  it("returns '0' for NaN", () => {
    expect(formatCompact(NaN)).toBe("0");
  });

  it("handles decimal input values", () => {
    expect(formatCompact(999.9)).toBe("999.9");
    expect(formatCompact(1_000.1)).toBe("1.0K");
    expect(formatCompact(1_234.56)).toBe("1.2K");
  });
});
