import { describe, expect, it } from "bun:test";
import { parseEventsQuery } from "../../src/lib/parse-events-query.js";

describe("parseEventsQuery", () => {
  it("rejects a missing type", () => {
    const result = parseEventsQuery({
      type: null,
      resource: null,
      from: null,
      limit: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("type");
    }
  });

  it("rejects a blank type", () => {
    const result = parseEventsQuery({
      type: "   ",
      resource: null,
      from: null,
      limit: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed 'from' date", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: "not-a-date",
      limit: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("from");
    }
  });

  it("normalizes blank resource/from to null", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: "  ",
      from: "  ",
      limit: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resource).toBeNull();
      expect(result.value.from).toBeNull();
    }
  });

  it("defaults limit to 50 when absent", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(50);
    }
  });

  it("caps limit at 500 (hard cap) even when a larger value is requested", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: "10000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(500);
    }
  });

  it("passes through a valid limit within bounds", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: "25",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(25);
    }
  });

  it("clamps a non-positive limit up to 1", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: "0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(1);
    }
  });

  it("passes through a valid 'from' and trims/keeps type and resource", () => {
    const result = parseEventsQuery({
      type: " connector.endpoint_call.completed.v1 ",
      resource: " adapter/adp-1 ",
      from: "2026-07-01T00:00:00.000Z",
      limit: "10",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("connector.endpoint_call.completed.v1");
      expect(result.value.resource).toBe("adapter/adp-1");
      expect(result.value.from).toBe("2026-07-01T00:00:00.000Z");
    }
  });
});
