// Unit tests for the trace_id validity predicate — regression coverage for
// the trace-visualization defect fix: non-UUID correlation_ids (e.g.
// "memory:057092b6-9699-4dc6-96db-13eeec1d8167", "gateway_audit:58076")
// produce a `toTraceId` result that is NOT 32 lowercase hex chars, and the
// otel-collector rejects the WHOLE batch item with a 400 when such a value
// is exported as `traceId`.

import { describe, expect, it } from "bun:test";
import { isValidTraceId } from "../src/lib/is-valid-trace-id.js";

describe("isValidTraceId", () => {
  it("accepts a 32-char lowercase hex string (dashes-stripped UUID)", () => {
    expect(
      isValidTraceId("11111111111111111111111111111111".slice(0, 32))
    ).toBe(true);
    expect(isValidTraceId("aaaaaaaabbbbccccddddeeeeeeeeeeee")).toBe(true);
  });

  it("rejects a colon-prefixed non-UUID correlation_id (memory: family)", () => {
    // "memory:057092b6-9699-4dc6-96db-13eeec1d8167" with dashes stripped —
    // contains ":" and letters beyond a-f, and is not 32 chars.
    expect(isValidTraceId("memory057092b696994dc696db13eeec1d8167")).toBe(
      false
    );
  });

  it("rejects a colon-prefixed short id (gateway_audit: family)", () => {
    expect(isValidTraceId("gatewayaudit58076")).toBe(false);
  });

  it("rejects a string that is too short", () => {
    expect(isValidTraceId("aaaa")).toBe(false);
  });

  it("rejects a string that is too long", () => {
    expect(isValidTraceId("a".repeat(33))).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(isValidTraceId("A".repeat(32))).toBe(false);
  });

  it("rejects a well-formed 32-hex trace_id that is all zeros (OTel-invalid)", () => {
    expect(isValidTraceId("0".repeat(32))).toBe(false);
  });
});
