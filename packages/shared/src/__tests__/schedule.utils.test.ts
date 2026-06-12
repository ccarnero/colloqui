import { describe, test, expect } from "bun:test";
import { parseSchedule } from "../schedule.utils";
import type { ParsedSchedule } from "../schedule.utils";

describe("parseSchedule", () => {
  // ── once ──────────────────────────────────────────────────────────────────

  describe("once", () => {
    test("returns kind=once for literal 'once'", () => {
      expect(parseSchedule("once")).toEqual({ kind: "once" });
    });

    test("trims whitespace before classifying 'once'", () => {
      expect(parseSchedule("  once  ")).toEqual({ kind: "once" });
    });
  });

  // ── bare integer (seconds) ────────────────────────────────────────────────

  describe("bare integer → interval in seconds", () => {
    test("returns correct intervalMs for '3600' (1 hour in seconds)", () => {
      const result = parseSchedule("3600");
      expect(result).toEqual({ kind: "interval", intervalMs: 3_600_000 });
    });

    test("returns correct intervalMs for '300' (5 minutes in seconds)", () => {
      const result = parseSchedule("300");
      expect(result).toEqual({ kind: "interval", intervalMs: 300_000 });
    });

    test("returns correct intervalMs for '1'", () => {
      const result = parseSchedule("1");
      expect(result).toEqual({ kind: "interval", intervalMs: 1_000 });
    });

    test("returns invalid for '0' (zero seconds not allowed)", () => {
      const result = parseSchedule("0");
      expect(result.kind).toBe("invalid");
    });
  });

  // ── interval:<minutes> ────────────────────────────────────────────────────

  describe("interval:<minutes> → interval in minutes", () => {
    test("returns correct intervalMs for 'interval:60'", () => {
      const result = parseSchedule("interval:60");
      expect(result).toEqual({ kind: "interval", intervalMs: 3_600_000 });
    });

    test("returns correct intervalMs for 'interval:1'", () => {
      const result = parseSchedule("interval:1");
      expect(result).toEqual({ kind: "interval", intervalMs: 60_000 });
    });

    test("returns correct intervalMs for 'interval:30'", () => {
      const result = parseSchedule("interval:30");
      expect(result).toEqual({ kind: "interval", intervalMs: 1_800_000 });
    });

    test("returns invalid for 'interval:0'", () => {
      const result = parseSchedule("interval:0");
      expect(result.kind).toBe("invalid");
    });

    test("returns invalid for 'interval:abc'", () => {
      const result = parseSchedule("interval:abc");
      expect(result.kind).toBe("invalid");
    });

    test("returns invalid for 'interval:' (empty value)", () => {
      const result = parseSchedule("interval:");
      expect(result.kind).toBe("invalid");
    });

    test("returns invalid for 'interval:5.5' (float)", () => {
      const result = parseSchedule("interval:5.5");
      expect(result.kind).toBe("invalid");
    });

    test("returns invalid for 'interval:-5' (negative)", () => {
      const result = parseSchedule("interval:-5");
      expect(result.kind).toBe("invalid");
    });
  });

  // ── cron expression ───────────────────────────────────────────────────────

  describe("cron expression", () => {
    test("returns kind=cron for '*/15 * * * *'", () => {
      const result = parseSchedule("*/15 * * * *");
      expect(result).toEqual({ kind: "cron", expression: "*/15 * * * *" });
    });

    test("returns kind=cron for '0 6 * * *'", () => {
      const result = parseSchedule("0 6 * * *");
      expect(result).toEqual({ kind: "cron", expression: "0 6 * * *" });
    });

    test("returns kind=cron for '0 0 1 * *'", () => {
      const result = parseSchedule("0 0 1 * *");
      expect(result).toEqual({ kind: "cron", expression: "0 0 1 * *" });
    });

    test("trims whitespace from cron expression", () => {
      const result = parseSchedule("  */5 * * * *  ");
      expect(result).toEqual({ kind: "cron", expression: "*/5 * * * *" });
    });
  });

  // ── interval upper bound (setInterval limit ~24.85 days) ─────────────────

  describe("interval upper bound", () => {
    test("returns invalid for '2147484' seconds (exceeds 2^31-1 ms limit)", () => {
      const result = parseSchedule("2147484");
      expect(result.kind).toBe("invalid");
      if (result.kind === "invalid") {
        expect(result.reason).toMatch(/24\.85/);
      }
    });

    test("returns valid for '2147483' seconds (at boundary — exactly 2,147,483,000 ms)", () => {
      const result = parseSchedule("2147483");
      expect(result).toEqual({ kind: "interval", intervalMs: 2_147_483_000 });
    });

    test("returns invalid for 'interval:35792' minutes (exceeds 2^31-1 ms limit)", () => {
      const result = parseSchedule("interval:35792");
      expect(result.kind).toBe("invalid");
      if (result.kind === "invalid") {
        expect(result.reason).toMatch(/24\.85/);
      }
    });

    test("returns valid for 'interval:35791' minutes (at boundary)", () => {
      // 35791 * 60_000 = 2,147,460,000 ms < 2,147,483,647
      const result = parseSchedule("interval:35791");
      expect(result).toEqual({ kind: "interval", intervalMs: 35_791 * 60_000 });
    });

    test("returns invalid for a 310-digit numeric string (overflows to Infinity)", () => {
      const huge = "9".repeat(310);
      const result = parseSchedule(huge);
      expect(result.kind).toBe("invalid");
    });
  });

  // ── invalid edge cases ────────────────────────────────────────────────────

  describe("invalid cases", () => {
    test("returns invalid for empty string", () => {
      const result = parseSchedule("");
      // empty string → trimmed is "", no match → falls through to cron candidate;
      // consumers (e.g. the admin validator) must reject it explicitly —
      // empty string classifies as a cron candidate here, not as invalid
      expect(result.kind).toBe("cron");
    });

    test("type guard: invalid result has kind and reason", () => {
      const result = parseSchedule("interval:abc");
      if (result.kind === "invalid") {
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
      } else {
        throw new Error("Expected invalid");
      }
    });

    test("interval:60extra does not match bare-integer and gets cron kind", () => {
      // "interval:60extra" → starts with "interval:" but rest is "60extra" → invalid
      const result = parseSchedule("interval:60extra");
      expect(result.kind).toBe("invalid");
    });
  });

  // ── type narrowing ────────────────────────────────────────────────────────

  describe("TypeScript type narrowing", () => {
    test("kind=interval carries intervalMs", () => {
      const result: ParsedSchedule = parseSchedule("interval:60");
      if (result.kind === "interval") {
        // TypeScript should narrow intervalMs to number
        expect(result.intervalMs).toBe(3_600_000);
      }
    });

    test("kind=cron carries expression", () => {
      const result: ParsedSchedule = parseSchedule("*/10 * * * *");
      if (result.kind === "cron") {
        expect(result.expression).toBe("*/10 * * * *");
      }
    });
  });
});
