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
