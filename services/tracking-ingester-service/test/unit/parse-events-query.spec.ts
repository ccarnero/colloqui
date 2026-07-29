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

  // T01 of manual-loops/connectors/endpoint-scoped-recent-calls.md —
  // `endpointId` follows the exact same normalization rule as
  // `resource`/`from`: trimmed, blank -> null, absent -> null, no format
  // validation (it is an opaque id).
  it("trims and passes through a provided endpointId", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: "adapter/adp-1",
      from: null,
      limit: null,
      endpointId: "  ep-42  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpointId).toBe("ep-42");
      // Composes with `resource` — never replaces it.
      expect(result.value.resource).toBe("adapter/adp-1");
    }
  });

  it("normalizes a blank endpointId to null", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: null,
      endpointId: "   ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpointId).toBeNull();
    }
  });

  it("normalizes an absent endpointId to null", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpointId).toBeNull();
    }
  });

  it("accepts an endpointId of any shape (opaque id — no format validation)", () => {
    const result = parseEventsQuery({
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: null,
      endpointId: "not/a/uuid but still accepted",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpointId).toBe("not/a/uuid but still accepted");
    }
  });

  // T06 of manual-loops/connectors/endpoint-scoped-recent-calls.md —
  // `toolName` follows the exact same normalization rule as
  // `resource`/`from`/`endpointId`: trimmed, blank -> null, absent -> null, no
  // format validation (it is an opaque tool name matched verbatim).
  it("trims and passes through a provided toolName", () => {
    const result = parseEventsQuery({
      type: "connector.mcp_call.completed.v1",
      resource: "mcp/mcp-1",
      from: null,
      limit: null,
      endpointId: "ep-42",
      toolName: "  search_docs  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolName).toBe("search_docs");
      // Composes with `resource`/`endpointId` — never replaces them.
      expect(result.value.resource).toBe("mcp/mcp-1");
      expect(result.value.endpointId).toBe("ep-42");
    }
  });

  it("normalizes a blank toolName to null", () => {
    const result = parseEventsQuery({
      type: "connector.mcp_call.completed.v1",
      resource: null,
      from: null,
      limit: null,
      toolName: "   ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolName).toBeNull();
    }
  });

  it("normalizes an absent toolName to null", () => {
    const result = parseEventsQuery({
      type: "connector.mcp_call.completed.v1",
      resource: null,
      from: null,
      limit: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolName).toBeNull();
    }
  });

  it("accepts a toolName of any shape (opaque name — no format validation)", () => {
    const result = parseEventsQuery({
      type: "connector.mcp_call.completed.v1",
      resource: null,
      from: null,
      limit: null,
      toolName: "weird tool/name v2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolName).toBe("weird tool/name v2");
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
