import { describe, expect, it } from "bun:test";
import { buildEventsQuery } from "../../src/lib/build-events-query.js";

describe("buildEventsQuery", () => {
  it("scopes strictly by tenant and filters by envelope->>'type'", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: 50,
    });
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("FROM tracking.tracked_events");
    expect(normalized).toContain("WHERE tenant = $1");
    expect(normalized).toContain("envelope->>'type' = $2");
    expect(normalized).not.toContain("OR tenant IS NULL");
  });

  it("never selects *", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: 50,
    });
    expect(text).not.toMatch(/SELECT\s+\*/i);
  });

  it("excludes the raw envelope jsonb column but projects the payload scalars", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: 50,
    });
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    expect(columnsBlock).not.toMatch(/,\s*envelope,/);
    expect(columnsBlock).not.toMatch(/,\s*envelope\s*$/);
    // Never leak requestBody/responseBody — only the five named scalars.
    expect(columnsBlock).not.toContain("requestBody");
    expect(columnsBlock).not.toContain("responseBody");
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'method' AS payload_method"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'resolvedUrl' AS payload_resolved_url"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'status' AS payload_http_status"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'durationMs' AS payload_duration_ms"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'cacheResult' AS payload_cache_result"
    );
  });

  it("orders occurred_at DESC (most recent first)", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: 50,
    });
    expect(text).toContain("ORDER BY occurred_at DESC");
  });

  it("omits the resource and from conditions when not provided, and binds limit as $3", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      limit: 50,
    });
    expect(text).not.toContain("resource");
    expect(text).not.toContain("occurred_at >=");
    expect(text).toContain("LIMIT $3");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      50,
    ]);
  });

  it("adds the resource filter on envelope->>'resource' when provided", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: "adapter/adp-1",
      from: null,
      limit: 50,
    });
    expect(text).toContain("envelope->>'resource' = $3");
    expect(text).toContain("LIMIT $4");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      "adapter/adp-1",
      50,
    ]);
  });

  it("adds the occurred_at lower bound when 'from' is provided", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: "2026-07-01T00:00:00.000Z",
      limit: 50,
    });
    expect(text).toContain("occurred_at >= $3");
    expect(text).toContain("LIMIT $4");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      "2026-07-01T00:00:00.000Z",
      50,
    ]);
  });

  // T05 of connection-call-inspector.md: serviceCall/raw/mcp reuse the
  // generic envelope->>'resource' verbatim match, unlike the special-cased
  // `agent/<agentId>` shape below.
  it.each([
    "service/hosted-crm",
    "raw/api.example.com",
    "mcp/mcp-server-1",
  ])("filters generically on envelope->>'resource' for the new resource prefix %s", (resourceValue) => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: resourceValue,
      from: null,
      limit: 50,
    });
    expect(text).toContain("envelope->>'resource' = $3");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      resourceValue,
      50,
    ]);
  });

  // T05 addendum: `agent/<agentId>` is the ONE resource shape that does NOT
  // match `envelope->>'resource'` verbatim — see build-events-query.ts's
  // header note (agent-execution events carry `resource: "execution/<id>"`,
  // not an agent-prefixed shape).
  it("filters on the payload agentId (COALESCE with the requested-kind's nested shape) for resource=agent/<id>", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "io.yoizen.platform.runtime.execution_completed.v1",
      resource: "agent/agent-123",
      from: null,
      limit: 50,
    });
    expect(text).not.toContain("envelope->>'resource'");
    expect(text).toContain(
      "COALESCE(envelope->'data'->'payload'->>'agentId', envelope->'data'->'payload'->'input'->>'agentId') = $3"
    );
    expect(params).toEqual([
      "tenant-a",
      "io.yoizen.platform.runtime.execution_completed.v1",
      "agent-123",
      50,
    ]);
  });

  it("combines resource and from with correctly ordered positional params", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: "adapter/adp-1",
      from: "2026-07-01T00:00:00.000Z",
      limit: 25,
    });
    expect(text).toContain("envelope->>'resource' = $3");
    expect(text).toContain("occurred_at >= $4");
    expect(text).toContain("LIMIT $5");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      "adapter/adp-1",
      "2026-07-01T00:00:00.000Z",
      25,
    ]);
  });
});
