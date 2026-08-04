import { describe, expect, it } from "bun:test";
import type { EventEnvelope } from "@yoizen/shared";
import { parseInvokeRequestedEnvelope } from "../../src/lib/invoke-consumer/parse-invoke-requested-envelope";

const SUBJECT =
  "evt.acme.connector-runtime.platform.endpoint.system.invoke_requested.v1";

function buildEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    specversion: "1.0",
    id: "evt-1",
    source: "connector-runtime/endpoint-invoke",
    type: "connector.endpoint.invoke_requested.v1",
    resource: "invocation/inv-1",
    time: "2026-07-14T00:00:00.000Z",
    traceid: "trace-1",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: "acme",
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    accountid: "acme",
    idempotencykey: "idem-1",
    transport: { method: "queue_bridge", protocol: "internal", depth: 0 },
    data: {
      received_at: "2026-07-14T00:00:00.000Z",
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "checksum",
      payload: {
        connectorId: "adp-1",
        endpointId: "ep-1",
        args: {
          method: "GET",
          url: "",
          adapterId: "adp-1",
          endpointId: "ep-1",
        },
      },
    },
    ...overrides,
  };
}

describe("parseInvokeRequestedEnvelope", () => {
  it("extracts tenant/invocationId/connectorId/endpointId/args/causal", () => {
    const result = parseInvokeRequestedEnvelope(buildEnvelope(), SUBJECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tenantId).toBe("acme");
      expect(result.value.invocationId).toBe("inv-1");
      expect(result.value.connectorId).toBe("adp-1");
      expect(result.value.endpointId).toBe("ep-1");
      expect(result.value.args.method).toBe("GET");
      expect(result.value.causal).toEqual({
        correlation_id: "corr-1",
        causation_id: "evt-1",
        depth: 0,
      });
      expect(result.value.webhook).toBeUndefined();
    }
  });

  it("extracts an optional webhook target", () => {
    const envelope = buildEnvelope({
      data: {
        ...buildEnvelope().data,
        payload: {
          connectorId: "adp-1",
          endpointId: "ep-1",
          args: { method: "GET" },
          webhook: { url: "https://caller.example/hook", headers: { a: "b" } },
        },
      },
    });
    const result = parseInvokeRequestedEnvelope(envelope, SUBJECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.webhook).toEqual({
        url: "https://caller.example/hook",
        headers: { a: "b" },
      });
    }
  });

  it("rejects a subject that does not match the 8-token shape", () => {
    const result = parseInvokeRequestedEnvelope(
      buildEnvelope(),
      "not.a.subject"
    );
    expect(result.ok).toBe(false);
  });

  it("rejects tenant mismatch between subject and envelope", () => {
    const envelope = buildEnvelope({ tenant: "globex" });
    const result = parseInvokeRequestedEnvelope(envelope, SUBJECT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("tenant mismatch");
    }
  });

  it("rejects a resource that does not match invocation/<id>", () => {
    const envelope = buildEnvelope({ resource: "adapter/adp-1" });
    const result = parseInvokeRequestedEnvelope(envelope, SUBJECT);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing payload.connectorId", () => {
    const envelope = buildEnvelope({
      data: {
        ...buildEnvelope().data,
        payload: { endpointId: "ep-1", args: { method: "GET" } },
      },
    });
    const result = parseInvokeRequestedEnvelope(envelope, SUBJECT);
    expect(result.ok).toBe(false);
  });

  it("rejects payload.args without a method", () => {
    const envelope = buildEnvelope({
      data: {
        ...buildEnvelope().data,
        payload: { connectorId: "adp-1", endpointId: "ep-1", args: {} },
      },
    });
    const result = parseInvokeRequestedEnvelope(envelope, SUBJECT);
    expect(result.ok).toBe(false);
  });

  it("rejects a webhook without a url", () => {
    const envelope = buildEnvelope({
      data: {
        ...buildEnvelope().data,
        payload: {
          connectorId: "adp-1",
          endpointId: "ep-1",
          args: { method: "GET" },
          webhook: {},
        },
      },
    });
    const result = parseInvokeRequestedEnvelope(envelope, SUBJECT);
    expect(result.ok).toBe(false);
  });
});
