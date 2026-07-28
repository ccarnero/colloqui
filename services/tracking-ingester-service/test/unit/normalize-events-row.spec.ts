import { describe, expect, it } from "bun:test";
import type { EventRow } from "../../src/lib/build-events-query.js";
import {
  normalizeEventsRow,
  type RawEventRow,
} from "../../src/lib/normalize-events-row.js";

const BASE: EventRow = {
  event_id: "evt-1",
  subject:
    "evt.tenant-a.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1",
  tenant: "tenant-a",
  producer: "connector-runtime",
  domain: "platform",
  kind: "endpoint_call_completed",
  version: "v1",
  correlation_id: "corr-1",
  causation_id: null,
  causation_depth: 0,
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

describe("normalizeEventsRow", () => {
  it("normalizes a Date occurred_at into an ISO-8601 millisecond string", () => {
    const raw: RawEventRow = {
      ...BASE,
      occurred_at: new Date("2026-07-11T15:38:33.726Z"),
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.occurred_at).toBe("2026-07-11T15:38:33.726Z");
    expect(typeof normalized.occurred_at).toBe("string");
  });

  it("passes through an already-string occurred_at unchanged", () => {
    const raw: RawEventRow = {
      ...BASE,
      occurred_at: "2026-07-01T00:00:00.000Z",
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.occurred_at).toBe("2026-07-01T00:00:00.000Z");
  });

  it("converts payload_http_status from numeric text to a number", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_http_status: "200",
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_http_status).toBe(200);
    expect(typeof normalized.payload_http_status).toBe("number");
  });

  it("converts payload_duration_ms from numeric text to a number", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_duration_ms: "125",
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_duration_ms).toBe(125);
    expect(typeof normalized.payload_duration_ms).toBe("number");
  });

  it("normalizes null numeric payload fields to null", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_http_status: null,
      payload_duration_ms: null,
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_http_status).toBeNull();
    expect(normalized.payload_duration_ms).toBeNull();
  });

  it("degrades a non-numeric payload_http_status to null instead of NaN", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_http_status: "not-a-number",
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_http_status).toBeNull();
  });

  it("preserves the string payload scalars verbatim", () => {
    const raw: RawEventRow = { ...BASE };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_method).toBe("GET");
    expect(normalized.payload_resolved_url).toBe(
      "https://api.example.com/data"
    );
    expect(normalized.payload_cache_result).toBe("hit");
  });

  // T06 of manual-loops/connectors/connection-call-inspector.md — MCP call
  // scalars (`connector.mcp_call.completed.v1`).
  it("converts payload_success from jsonb boolean text to a real boolean", () => {
    const raw: RawEventRow = { ...BASE, payload_success: "true" };
    expect(normalizeEventsRow(raw).payload_success).toBe(true);
    const rawFalse: RawEventRow = { ...BASE, payload_success: "false" };
    expect(normalizeEventsRow(rawFalse).payload_success).toBe(false);
  });

  it("degrades a non-boolean payload_success to null instead of misreporting success", () => {
    const raw: RawEventRow = { ...BASE, payload_success: "maybe" };
    expect(normalizeEventsRow(raw).payload_success).toBeNull();
  });

  it("normalizes null payload_success to null", () => {
    const raw: RawEventRow = { ...BASE, payload_success: null };
    expect(normalizeEventsRow(raw).payload_success).toBeNull();
  });

  it("preserves payload_tool_name and payload_error verbatim for MCP calls", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_tool_name: "search_docs",
      payload_error: "timeout after 30s",
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_tool_name).toBe("search_docs");
    expect(normalized.payload_error).toBe("timeout after 30s");
  });

  // T06 — standalone LLM call scalars (`ai.llm_call.completed.v1`).
  it("converts payload_input_tokens/payload_output_tokens/payload_cost_usd from text to numbers", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_input_tokens: "120",
      payload_output_tokens: "45",
      payload_cost_usd: "0.0023",
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_input_tokens).toBe(120);
    expect(normalized.payload_output_tokens).toBe(45);
    expect(normalized.payload_cost_usd).toBe(0.0023);
  });

  it("normalizes null token/cost payload fields to null", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_input_tokens: null,
      payload_output_tokens: null,
      payload_cost_usd: null,
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_input_tokens).toBeNull();
    expect(normalized.payload_output_tokens).toBeNull();
    expect(normalized.payload_cost_usd).toBeNull();
  });

  it("preserves payload_model and payload_provider verbatim", () => {
    const raw: RawEventRow = {
      ...BASE,
      payload_model: "gpt-4o",
      payload_provider: "openai",
    };
    const normalized = normalizeEventsRow(raw);
    expect(normalized.payload_model).toBe("gpt-4o");
    expect(normalized.payload_provider).toBe("openai");
  });

  // T06 — agent-execution lifecycle scalar
  // (`io.yoizen.platform.runtime.execution_completed.v1`).
  it("preserves payload_state verbatim", () => {
    const raw: RawEventRow = { ...BASE, payload_state: "completed" };
    expect(normalizeEventsRow(raw).payload_state).toBe("completed");
  });
});
