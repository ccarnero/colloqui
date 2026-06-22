import { describe, expect, it } from "bun:test";
import { truncateBody } from "../../src/activities/_shared/truncate-body";

describe("truncateBody", () => {
  it("returns undefined for undefined input", () => {
    const result = truncateBody(undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined for null input", () => {
    const result = truncateBody(null);
    expect(result).toBeUndefined();
  });

  it("returns string input unchanged if short", () => {
    const result = truncateBody("hello");
    expect(result).toBe("hello");
  });

  it("serializes object to JSON", () => {
    const result = truncateBody({ a: 1 });
    expect(result).toBe('{"a":1}');
  });

  it("serializes nested object to JSON", () => {
    const result = truncateBody({ a: { b: 2 } });
    expect(result).toBe('{"a":{"b":2}}');
  });

  it("truncates string longer than 8192 characters", () => {
    const longStr = "x".repeat(8193);
    const result = truncateBody(longStr);
    expect(result).toBeDefined();
    expect(result!.length).toBe(8192);
    expect(result).toBe("x".repeat(8192));
  });

  it("truncates object serialization longer than 8192 characters", () => {
    const obj = { data: "x".repeat(9000) };
    const result = truncateBody(obj);
    expect(result).toBeDefined();
    expect(result!.length).toBe(8192);
  });

  it("returns exactly 8192 characters for boundary case", () => {
    const str = "a".repeat(8192);
    const result = truncateBody(str);
    expect(result).toBe(str);
    expect(result!.length).toBe(8192);
  });

  it("handles empty string", () => {
    const result = truncateBody("");
    expect(result).toBe("");
  });

  it("handles empty object", () => {
    const result = truncateBody({});
    expect(result).toBe("{}");
  });

  it("handles array", () => {
    const result = truncateBody([1, 2, 3]);
    expect(result).toBe("[1,2,3]");
  });

  it("handles boolean", () => {
    const result = truncateBody(true);
    expect(result).toBe("true");
  });

  it("handles number", () => {
    const result = truncateBody(42);
    expect(result).toBe("42");
  });

  it("truncates complex object correctly", () => {
    const largePayload = {
      nested: {
        deeply: {
          value: "x".repeat(10000),
        },
      },
    };
    const result = truncateBody(largePayload);
    expect(result).toBeDefined();
    expect(result!.length).toBe(8192);
  });
});
