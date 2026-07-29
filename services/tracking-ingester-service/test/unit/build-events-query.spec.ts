import { describe, expect, it } from "bun:test";
import { buildEventsQuery } from "../../src/lib/build-events-query.js";

describe("buildEventsQuery", () => {
  it("scopes strictly by tenant and filters by envelope->>'type'", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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
      endpointId: null,
      toolName: null,
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

  // T06 of manual-loops/connectors/connection-call-inspector.md: type-aware
  // scalar projections for MCP calls, LLM calls, and agent-execution
  // lifecycle. The column list is static (always the full known superset —
  // see the header/EventRow docs) so these columns appear regardless of
  // which `type` was requested; the assertions below just confirm the new
  // columns exist and bodies stay excluded.
  it("projects MCP call scalars (toolName, success, error) without arguments/result", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.mcp_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: null,
      limit: 50,
    });
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'toolName' AS payload_tool_name"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'success' AS payload_success"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'error' AS payload_error"
    );
    expect(columnsBlock).not.toContain("arguments");
    expect(columnsBlock).not.toContain("'result'");
  });

  it("projects LLM call scalars (model, provider, tokens, cost) without prompt/completion", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "ai.llm_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: null,
      limit: 50,
    });
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'model' AS payload_model"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'provider' AS payload_provider"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'inputTokens' AS payload_input_tokens"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'outputTokens' AS payload_output_tokens"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'costUsd' AS payload_cost_usd"
    );
    expect(columnsBlock).not.toContain("prompt");
    expect(columnsBlock).not.toContain("completion");
  });

  it("projects agent-execution lifecycle scalars (state, model, costUsd)", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "io.yoizen.platform.runtime.execution_completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: null,
      limit: 50,
    });
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'state' AS payload_state"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'model' AS payload_model"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'costUsd' AS payload_cost_usd"
    );
    expect(columnsBlock).not.toContain("response");
    expect(columnsBlock).not.toContain("toolCalls");
    expect(columnsBlock).not.toContain("toolResults");
  });

  // T01 of manual-loops/connectors/endpoint-scoped-recent-calls.md — the
  // `endpointId` filter matches `envelope->'data'->'payload'->>'endpointId'`
  // verbatim (the field `connector-runtime`'s
  // `src/activities/_shared/event-publisher.ts:81` publishes) and COMPOSES
  // with `type`/`resource`/`from` instead of replacing any of them.
  it("projects the payload endpointId scalar as payload_endpoint_id", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: null,
      limit: 50,
    });
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'endpointId' AS payload_endpoint_id"
    );
  });

  it("omits the endpointId condition when not provided", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: null,
      limit: 50,
    });
    const whereBlock = text.slice(text.indexOf("WHERE"));
    expect(whereBlock).not.toContain("endpointId");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      50,
    ]);
  });

  it("adds the endpointId filter on the payload endpointId when provided", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: null,
      from: null,
      endpointId: "ep-42",
      toolName: null,
      limit: 50,
    });
    expect(text).toContain("envelope->'data'->'payload'->>'endpointId' = $3");
    expect(text).toContain("LIMIT $4");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      "ep-42",
      50,
    ]);
  });

  it("composes endpointId with resource and from (never replaces them)", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: "adapter/adp-1",
      from: "2026-07-01T00:00:00.000Z",
      endpointId: "ep-42",
      toolName: null,
      limit: 25,
    });
    expect(text).toContain("envelope->>'resource' = $3");
    expect(text).toContain("occurred_at >= $4");
    expect(text).toContain("envelope->'data'->'payload'->>'endpointId' = $5");
    expect(text).toContain("LIMIT $6");
    expect(params).toEqual([
      "tenant-a",
      "connector.endpoint_call.completed.v1",
      "adapter/adp-1",
      "2026-07-01T00:00:00.000Z",
      "ep-42",
      25,
    ]);
  });

  it("combines resource and from with correctly ordered positional params", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.endpoint_call.completed.v1",
      resource: "adapter/adp-1",
      from: "2026-07-01T00:00:00.000Z",
      endpointId: null,
      toolName: null,
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

  // T06 of manual-loops/connectors/endpoint-scoped-recent-calls.md — the
  // `toolName` filter matches `envelope->'data'->'payload'->>'toolName'`
  // verbatim (the same field the `payload_tool_name` projection column
  // already reads — NO new projection column) and COMPOSES with
  // `type`/`resource`/`from`/`endpointId` instead of replacing any of them.
  it("omits the toolName condition when not provided", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.mcp_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: null,
      limit: 50,
    });
    const whereBlock = text.slice(text.indexOf("WHERE"));
    expect(whereBlock).not.toContain("toolName");
    expect(params).toEqual(["tenant-a", "connector.mcp_call.completed.v1", 50]);
  });

  it("adds the toolName filter on the payload toolName when provided", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.mcp_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: "search_docs",
      limit: 50,
    });
    expect(text).toContain("envelope->'data'->'payload'->>'toolName' = $3");
    expect(text).toContain("LIMIT $4");
    expect(params).toEqual([
      "tenant-a",
      "connector.mcp_call.completed.v1",
      "search_docs",
      50,
    ]);
  });

  it("adds NO new projection column for the toolName filter", () => {
    const { text } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.mcp_call.completed.v1",
      resource: null,
      from: null,
      endpointId: null,
      toolName: "search_docs",
      limit: 50,
    });
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    // The pre-existing scalar is the ONLY `toolName` reference in the
    // projection — the filter lives in the WHERE clause.
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'toolName' AS payload_tool_name"
    );
    expect(
      columnsBlock.split("toolName").length - 1,
      "projection must reference toolName exactly once"
    ).toBe(1);
  });

  it("composes toolName with resource, from and endpointId (never replaces them)", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.mcp_call.completed.v1",
      resource: "mcp/mcp-1",
      from: "2026-07-01T00:00:00.000Z",
      endpointId: "ep-42",
      toolName: "search_docs",
      limit: 25,
    });
    expect(text).toContain("envelope->>'resource' = $3");
    expect(text).toContain("occurred_at >= $4");
    expect(text).toContain("envelope->'data'->'payload'->>'endpointId' = $5");
    expect(text).toContain("envelope->'data'->'payload'->>'toolName' = $6");
    expect(text).toContain("LIMIT $7");
    expect(params).toEqual([
      "tenant-a",
      "connector.mcp_call.completed.v1",
      "mcp/mcp-1",
      "2026-07-01T00:00:00.000Z",
      "ep-42",
      "search_docs",
      25,
    ]);
  });

  it("composes toolName with resource alone", () => {
    const { text, params } = buildEventsQuery({
      tenant: "tenant-a",
      type: "connector.mcp_call.completed.v1",
      resource: "mcp/mcp-1",
      from: null,
      endpointId: null,
      toolName: "search_docs",
      limit: 25,
    });
    expect(text).toContain("envelope->>'resource' = $3");
    expect(text).toContain("envelope->'data'->'payload'->>'toolName' = $4");
    expect(text).toContain("LIMIT $5");
    expect(params).toEqual([
      "tenant-a",
      "connector.mcp_call.completed.v1",
      "mcp/mcp-1",
      "search_docs",
      25,
    ]);
  });
});
