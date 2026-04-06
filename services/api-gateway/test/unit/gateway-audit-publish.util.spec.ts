import "reflect-metadata";
import { describe, it, expect, mock } from "bun:test";
import type { GatewayAuditEvent } from "@yoizen/shared";
import { GATEWAY_AUDIT_SUBJECT, TENANT_HEADER } from "@yoizen/shared";
import { publishGatewayAuditEvent } from "../../src/utils/gateway-audit-publish.util";

function minimalEvent(): GatewayAuditEvent {
  return {
    requestId: "r1",
    traceId: "t1",
    timestamp: new Date().toISOString(),
    tenantId: "tenant-a",
    method: "GET",
    path: "/x",
    statusCode: 200,
    durationMs: 1,
    clientIp: "127.0.0.1",
    userAgent: "test",
    jwtSubject: null,
    routeType: "platform",
    rateLimitApplied: false,
  };
}

describe("publishGatewayAuditEvent", () => {
  it("publishes to GATEWAY_AUDIT_SUBJECT with tenant header", async () => {
    const publish = mock(() => Promise.resolve());
    const js = { publish } as import("nats").JetStreamClient;
    const onError = mock(() => {});

    publishGatewayAuditEvent({
      js,
      event: minimalEvent(),
      tenantId: "tenant-a",
      onError,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(publish).toHaveBeenCalledTimes(1);
    const [subject, payload, opts] = publish.mock.calls[0] as [
      string,
      Uint8Array,
      { headers?: { get: (k: string) => string | undefined } },
    ];
    expect(subject).toBe(GATEWAY_AUDIT_SUBJECT);
    expect(opts?.headers?.get(TENANT_HEADER)).toBe("tenant-a");
    const decoded = JSON.parse(
      new TextDecoder().decode(payload),
    ) as GatewayAuditEvent;
    expect(decoded.requestId).toBe("r1");
  });

  it("invokes onError when publish rejects", async () => {
    const err = new Error("jetstream down");
    const publish = mock(() => Promise.reject(err));
    const js = { publish } as import("nats").JetStreamClient;
    const onError = mock(() => {});

    publishGatewayAuditEvent({
      js,
      event: minimalEvent(),
      tenantId: "t1",
      onError,
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(err);
  });
});
