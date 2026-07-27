import { describe, expect, it } from "vitest";
import { stringifyPayload } from "../stringify-payload";

describe("stringifyPayload", () => {
  it("returns null for null", () => {
    expect(stringifyPayload(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(stringifyPayload(undefined)).toBeNull();
  });

  it("passes a string through unchanged", () => {
    expect(stringifyPayload("hello")).toBe("hello");
  });

  it("pretty-prints an object with 2-space indentation", () => {
    expect(stringifyPayload({ a: 1, b: "two" })).toBe(
      JSON.stringify({ a: 1, b: "two" }, null, 2)
    );
  });

  it("pretty-prints a number", () => {
    expect(stringifyPayload(42)).toBe("42");
  });

  it("falls back to String(v) when JSON.stringify throws (circular structure)", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(stringifyPayload(circular)).toBe(String(circular));
  });
});
