import { describe, expect, it } from "bun:test";
import type {
  EventRow,
  EventsQuery,
} from "../../src/lib/build-events-query.js";
import { handleEventsRequest } from "../../src/lib/handle-events-request.js";

const EVENT: EventRow = {
  event_id: "evt-1",
  subject:
    "evt.tenant-a.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1",
  tenant: "tenant-a",
  producer: "connector-runtime",
  domain: "platform",
  kind: "endpoint_call_completed",
  version: "v1",
  correlation_id: "corr-1",
  causation_id: "evt-parent",
  causation_depth: 2,
  occurred_at: "2026-07-01T00:00:00.000Z",
  tech: "connector",
  business_fn: "connector-invocation",
  rule: 11,
  consumed_by: [],
  is_claim_check: false,
  compliance: "full",
  workflow_id: null,
  run_id: null,
  connector_id: "adp-1",
  cache_status: "hit",
  has_envelope: true,
  payload_method: "GET",
  payload_resolved_url: "https://api.example.com/data",
  payload_http_status: 200,
  payload_duration_ms: 50,
  payload_cache_result: "hit",
  payload_endpoint_id: "ep-42",
  payload_tool_name: null,
  payload_success: null,
  payload_error: null,
  payload_model: null,
  payload_provider: null,
  payload_input_tokens: null,
  payload_output_tokens: null,
  payload_cost_usd: null,
  payload_state: null,
};

/** T06 of manual-loops/connectors/endpoint-scoped-recent-calls.md — an MCP
 * tool call row: the `payload_tool_name` scalar already existed in the
 * projection, this task only added the `toolName` FILTER. */
const MCP_EVENT: EventRow = {
  ...EVENT,
  event_id: "evt-mcp-1",
  subject:
    "evt.tenant-a.connector-runtime.platform.endpoint.system.mcp_call_completed.v1",
  kind: "mcp_call_completed",
  payload_method: null,
  payload_resolved_url: null,
  payload_http_status: null,
  payload_cache_result: null,
  payload_tool_name: "search_docs",
  payload_success: true,
};

describe("handleEventsRequest", () => {
  it("returns 400 when tenant is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleEventsRequest(
      null,
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      {
        queryEvents: async () => {
          called = true;
          return [];
        },
      }
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 for a blank tenant header", async () => {
    const result = await handleEventsRequest(
      "  ",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      { queryEvents: async () => [] }
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when 'type' is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleEventsRequest(
      "tenant-a",
      { type: null, resource: null, from: null, limit: null },
      {
        queryEvents: async () => {
          called = true;
          return [];
        },
      }
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 when 'from' is malformed", async () => {
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: "not-a-date",
        limit: null,
      },
      { queryEvents: async () => [] }
    );
    expect(result.status).toBe(400);
  });

  it("routes the built query to the injected pool, scoped by tenant/type, and shapes a 200 response", async () => {
    let seenQuery: EventsQuery | null = null;
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: "adapter/adp-1",
        from: "2026-06-01T00:00:00.000Z",
        limit: "10",
      },
      {
        queryEvents: async (query) => {
          seenQuery = query;
          return [EVENT];
        },
      }
    );

    expect(seenQuery).not.toBeNull();
    expect(seenQuery!.params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      "adapter/adp-1",
      "2026-06-01T00:00:00.000Z",
      10,
    ]);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.tenant).toBe("tenant-a");
      expect(result.body.type).toBe("connector.endpoint_call.completed.v1");
      expect(result.body.resource).toBe("adapter/adp-1");
      expect(result.body.limit).toBe(10);
      expect(result.body.count).toBe(1);
      expect(result.body.events).toEqual([EVENT]);
    }
  });

  it("returns 200 with an empty events array when nothing matches (not a 404 — this is a filtered list)", async () => {
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      { queryEvents: async () => [] }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.events).toEqual([]);
      expect(result.body.count).toBe(0);
    }
  });

  it("defaults limit to 50 and passes it through to the query when not provided", async () => {
    let seenQuery: EventsQuery | null = null;
    await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      {
        queryEvents: async (query) => {
          seenQuery = query;
          return [];
        },
      }
    );
    expect(seenQuery!.params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      50,
    ]);
  });

  it("caps an oversized limit at 500 before it reaches the query", async () => {
    let seenQuery: EventsQuery | null = null;
    await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: "999999",
      },
      {
        queryEvents: async (query) => {
          seenQuery = query;
          return [];
        },
      }
    );
    expect(seenQuery!.params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      500,
    ]);
  });

  // T01 of manual-loops/connectors/endpoint-scoped-recent-calls.md — the
  // optional `endpointId` query param is the ONLY API-surface change: it is
  // parsed, forwarded to the query as an extra bound param (composing with
  // `resource`/`from`), and echoed on the response.
  it("forwards endpointId to the query, composing with resource and from, and echoes it", async () => {
    let seenQuery: EventsQuery | null = null;
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: "adapter/adp-1",
        from: "2026-06-01T00:00:00.000Z",
        limit: "10",
        endpointId: " ep-42 ",
      },
      {
        queryEvents: async (query) => {
          seenQuery = query;
          return [EVENT];
        },
      }
    );

    expect(seenQuery).not.toBeNull();
    expect(seenQuery!.text).toContain(
      "envelope->'data'->'payload'->>'endpointId' = $5"
    );
    expect(seenQuery!.params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      "adapter/adp-1",
      "2026-06-01T00:00:00.000Z",
      "ep-42",
      10,
    ]);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.endpointId).toBe("ep-42");
      expect(result.body.resource).toBe("adapter/adp-1");
      expect(result.body.events[0]!.payload_endpoint_id).toBe("ep-42");
    }
  });

  it("echoes a null endpointId and omits the filter when it is absent", async () => {
    let seenQuery: EventsQuery | null = null;
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      {
        queryEvents: async (query) => {
          seenQuery = query;
          return [EVENT];
        },
      }
    );
    expect(
      seenQuery!.text.slice(seenQuery!.text.indexOf("WHERE"))
    ).not.toContain("endpointId");
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.endpointId).toBeNull();
    }
  });

  it("logs the endpointId on both the fetching and OK verbose lines", async () => {
    const lines: string[] = [];
    await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
        endpointId: "ep-42",
      },
      {
        queryEvents: async () => [EVENT],
        log: (message) => lines.push(message),
      }
    );
    expect(lines.filter((l) => l.includes("endpointId=ep-42"))).toHaveLength(2);
  });

  // T06 of manual-loops/connectors/endpoint-scoped-recent-calls.md — the
  // optional `toolName` query param is the ONLY API-surface change: it is
  // parsed, forwarded to the query as an extra bound param (composing with
  // `resource`/`from`/`endpointId`), and echoed on the response. No new
  // projection column — `payload_tool_name` already existed.
  it("forwards toolName to the query, composing with resource, from and endpointId, and echoes it", async () => {
    let seenQuery: EventsQuery | null = null;
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.mcp_call.completed.v1",
        resource: "mcp/mcp-1",
        from: "2026-06-01T00:00:00.000Z",
        limit: "10",
        endpointId: "ep-42",
        toolName: " search_docs ",
      },
      {
        queryEvents: async (query) => {
          seenQuery = query;
          return [MCP_EVENT];
        },
      }
    );

    expect(seenQuery).not.toBeNull();
    expect(seenQuery!.text).toContain(
      "envelope->'data'->'payload'->>'toolName' = $6"
    );
    expect(seenQuery!.params).toEqual([
      "tenant-a",
      "connector.mcp_call.completed.v1",
      "mcp/mcp-1",
      "2026-06-01T00:00:00.000Z",
      "ep-42",
      "search_docs",
      10,
    ]);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.toolName).toBe("search_docs");
      expect(result.body.endpointId).toBe("ep-42");
      expect(result.body.resource).toBe("mcp/mcp-1");
      expect(result.body.events[0]!.payload_tool_name).toBe("search_docs");
    }
  });

  it("echoes a null toolName and omits the filter when it is absent", async () => {
    let seenQuery: EventsQuery | null = null;
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.mcp_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      {
        queryEvents: async (query) => {
          seenQuery = query;
          return [MCP_EVENT];
        },
      }
    );
    expect(
      seenQuery!.text.slice(seenQuery!.text.indexOf("WHERE"))
    ).not.toContain("toolName");
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.toolName).toBeNull();
    }
  });

  it("logs the toolName on both the fetching and OK verbose lines", async () => {
    const lines: string[] = [];
    await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.mcp_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
        toolName: "search_docs",
      },
      {
        queryEvents: async () => [MCP_EVENT],
        log: (message) => lines.push(message),
      }
    );
    expect(
      lines.filter((l) => l.includes("toolName=search_docs"))
    ).toHaveLength(2);
  });

  it("logs toolName=- on both verbose lines when no tool filter is applied", async () => {
    const lines: string[] = [];
    await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.mcp_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      {
        queryEvents: async () => [MCP_EVENT],
        log: (message) => lines.push(message),
      }
    );
    expect(lines.filter((l) => l.includes("toolName=-"))).toHaveLength(2);
  });

  it("never projects requestBody/responseBody onto the response events", async () => {
    const result = await handleEventsRequest(
      "tenant-a",
      {
        type: "connector.endpoint_call.completed.v1",
        resource: null,
        from: null,
        limit: null,
      },
      { queryEvents: async () => [EVENT] }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      const row = result.body.events[0] as unknown as Record<string, unknown>;
      expect(row["requestBody"]).toBeUndefined();
      expect(row["responseBody"]).toBeUndefined();
      expect(row["envelope"]).toBeUndefined();
    }
  });
});
