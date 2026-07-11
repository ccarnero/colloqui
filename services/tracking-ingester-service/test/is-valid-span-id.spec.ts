// Unit tests for the span_id / parent_span_id validity predicate. `event_id`
// is NOT guaranteed to be a UUID for non-envelope rows — T07 synthesizes
// `"<stream>:<seq>"` ids (e.g. "GATEWAY_AUDIT:41771", see to-tracked-event-row.ts),
// so `toSpanId` can also derive a non-hex value that the otel-collector rejects.

import { describe, expect, it } from "bun:test";
import { isValidSpanId } from "../src/lib/is-valid-span-id.js";

describe("isValidSpanId", () => {
  it("accepts a 16-char lowercase hex string (dashes-stripped UUID prefix)", () => {
    expect(isValidSpanId("aaaaaaaabbbbcccc")).toBe(true);
  });

  it("rejects a synthesized non-envelope event_id (stream:seq shape)", () => {
    // toSpanId("GATEWAY_AUDIT:41771") lowercases + strips dashes only, so the
    // colon and letters g/u/i/t survive — not valid hex.
    expect(isValidSpanId("gateway_audit:41")).toBe(false);
  });

  it("rejects a string that is too short", () => {
    expect(isValidSpanId("aaaa")).toBe(false);
  });

  it("rejects a string that is too long", () => {
    expect(isValidSpanId("a".repeat(17))).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(isValidSpanId("A".repeat(16))).toBe(false);
  });

  it("rejects an all-zero span_id (OTel-invalid)", () => {
    expect(isValidSpanId("0".repeat(16))).toBe(false);
  });
});
