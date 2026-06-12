import { describe, it, expect } from "bun:test";
import { calculateNextRun } from "../../src/modules/jobs/schedule.utils";
import { isValidSchedule } from "../../src/modules/jobs/schedule.validator";

// Fixed reference date for deterministic assertions
const FROM = new Date("2025-06-01T12:00:00.000Z");

describe("calculateNextRun", () => {
  // ── cron expression ───────────────────────────────────────────────────────

  describe("cron expression", () => {
    it("returns the next cron occurrence after FROM for '*/15 * * * *'", () => {
      // FROM is 2025-06-01T12:00:00Z → cron-parser next after 12:00 → 12:15:00
      const result = calculateNextRun("*/15 * * * *", FROM);
      expect(result).not.toBeNull();
      expect(result!.toISOString()).toBe("2025-06-01T12:15:00.000Z");
    });

    it("returns the next cron occurrence for daily midnight cron '0 0 * * *'", () => {
      // cron-parser computes in server-local time (intentional — croner also runs
      // in local time, so local-everywhere is consistent semantics).
      // Derive the expected value in local time to stay tz-agnostic in CI.
      const expected = new Date(FROM);
      expected.setHours(24, 0, 0, 0); // next local midnight after FROM (which is at 12:00)
      const result = calculateNextRun("0 0 * * *", FROM);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(expected.getTime());
    });

    it("returns null for a malformed cron expression (defensive — no throw)", () => {
      expect(() => calculateNextRun("not-a-cron", FROM)).not.toThrow();
      // "not-a-cron" has no spaces so cron-parser will reject it — returns null
      const result = calculateNextRun("not-a-cron", FROM);
      expect(result).toBeNull();
    });
  });

  // ── bare integer (seconds) ────────────────────────────────────────────────

  describe("bare integer → seconds", () => {
    it("returns FROM + 3600 seconds for '3600'", () => {
      const result = calculateNextRun("3600", FROM);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(FROM.getTime() + 3_600_000);
    });

    it("returns FROM + 1 second for '1'", () => {
      const result = calculateNextRun("1", FROM);
      expect(result!.getTime()).toBe(FROM.getTime() + 1_000);
    });

    it("returns null for '0' (zero seconds invalid)", () => {
      const result = calculateNextRun("0", FROM);
      expect(result).toBeNull();
    });
  });

  // ── interval:<minutes> ────────────────────────────────────────────────────

  describe("interval:<minutes>", () => {
    it("returns FROM + 60 minutes for 'interval:60'", () => {
      const result = calculateNextRun("interval:60", FROM);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(FROM.getTime() + 3_600_000);
    });

    it("returns FROM + 30 minutes for 'interval:30'", () => {
      const result = calculateNextRun("interval:30", FROM);
      expect(result!.getTime()).toBe(FROM.getTime() + 1_800_000);
    });

    it("returns null for 'interval:0'", () => {
      const result = calculateNextRun("interval:0", FROM);
      expect(result).toBeNull();
    });

    it("returns null for 'interval:abc'", () => {
      const result = calculateNextRun("interval:abc", FROM);
      expect(result).toBeNull();
    });

    it("returns null for 'interval:' (empty value)", () => {
      const result = calculateNextRun("interval:", FROM);
      expect(result).toBeNull();
    });
  });

  // ── once ──────────────────────────────────────────────────────────────────

  describe("once", () => {
    it("returns null for 'once'", () => {
      expect(calculateNextRun("once", FROM)).toBeNull();
    });
  });

  // ── interval upper bound ──────────────────────────────────────────────────

  describe("interval upper bound", () => {
    it("returns null for '2147484' seconds (exceeds setInterval limit)", () => {
      expect(calculateNextRun("2147484", FROM)).toBeNull();
    });

    it("returns null for 'interval:35792' minutes (exceeds setInterval limit)", () => {
      expect(calculateNextRun("interval:35792", FROM)).toBeNull();
    });

    it("returns null for a 310-digit numeric string (overflows to Infinity)", () => {
      expect(calculateNextRun("9".repeat(310), FROM)).toBeNull();
    });
  });

  // ── defaults FROM to now ──────────────────────────────────────────────────

  describe("default FROM = now", () => {
    it("does not throw when FROM is omitted", () => {
      expect(() => calculateNextRun("interval:60")).not.toThrow();
    });

    it("returns a date approximately FROM + intervalMs when omitted", () => {
      const before = Date.now();
      const result = calculateNextRun("interval:60");
      const after = Date.now();
      expect(result).not.toBeNull();
      // Should be between before+60min and after+60min (with a 1s tolerance)
      expect(result!.getTime()).toBeGreaterThanOrEqual(before + 3_600_000 - 1_000);
      expect(result!.getTime()).toBeLessThanOrEqual(after + 3_600_000 + 1_000);
    });
  });
});

describe("isValidSchedule (DTO validator)", () => {
  // ── accepts valid schedules ───────────────────────────────────────────────

  it("accepts 'once'", () => {
    expect(isValidSchedule("once")).toBe(true);
  });

  it("accepts bare positive integer (seconds)", () => {
    expect(isValidSchedule("3600")).toBe(true);
  });

  it("accepts 'interval:60'", () => {
    expect(isValidSchedule("interval:60")).toBe(true);
  });

  it("accepts a valid cron expression '*/15 * * * *'", () => {
    expect(isValidSchedule("*/15 * * * *")).toBe(true);
  });

  it("accepts '0 6 * * *' (daily at 6am)", () => {
    expect(isValidSchedule("0 6 * * *")).toBe(true);
  });

  // ── rejects invalid schedules ─────────────────────────────────────────────

  it("rejects 'interval:abc'", () => {
    expect(isValidSchedule("interval:abc")).toBe(false);
  });

  it("rejects 'interval:0' (zero minutes)", () => {
    expect(isValidSchedule("interval:0")).toBe(false);
  });

  it("rejects 'interval:' (empty value)", () => {
    expect(isValidSchedule("interval:")).toBe(false);
  });

  it("rejects '0' (zero seconds)", () => {
    expect(isValidSchedule("0")).toBe(false);
  });

  it("rejects non-string value", () => {
    expect(isValidSchedule(42)).toBe(false);
    expect(isValidSchedule(null)).toBe(false);
    expect(isValidSchedule(undefined)).toBe(false);
  });

  it("rejects an invalid cron expression (too few fields)", () => {
    // A plain word with no spaces — cron-parser will reject it
    expect(isValidSchedule("invalid-cron-string")).toBe(false);
  });

  it("rejects 'interval:5.5' (float)", () => {
    expect(isValidSchedule("interval:5.5")).toBe(false);
  });

  it("rejects empty string (cron-parser v5 would silently treat it as every-minute; admin validator must block it)", () => {
    expect(isValidSchedule("")).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(isValidSchedule("   ")).toBe(false);
  });

  // ── interval upper bound (setInterval / toad-scheduler limit ~24.85 days) ─

  it("rejects '2147484' seconds (exceeds 2^31-1 ms setInterval limit)", () => {
    expect(isValidSchedule("2147484")).toBe(false);
  });

  it("rejects 'interval:35792' minutes (exceeds 2^31-1 ms setInterval limit)", () => {
    expect(isValidSchedule("interval:35792")).toBe(false);
  });

  it("rejects a 310-digit numeric string (overflows Number to Infinity)", () => {
    expect(isValidSchedule("9".repeat(310))).toBe(false);
  });

  it("accepts '2147483' seconds (at boundary — within setInterval limit)", () => {
    expect(isValidSchedule("2147483")).toBe(true);
  });

  it("accepts 'interval:35791' minutes (at boundary — within setInterval limit)", () => {
    expect(isValidSchedule("interval:35791")).toBe(true);
  });
});
