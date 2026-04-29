import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import {
  TENANT_READY_SUBJECT,
  TenantDatabaseTier,
  isTenantReadyMessageV1,
} from "@yoizen/shared";
import { TenantReadyPublisher } from "../../src/providers/tenant-ready-publisher.service";
import type { NatsConnection } from "nats";

interface CapturedPublish {
  subject: string;
  body: unknown;
}

function buildPublisher(opts?: { failOnPublish?: boolean }): {
  publisher: TenantReadyPublisher;
  captured: CapturedPublish[];
  publish: ReturnType<typeof mock>;
} {
  const captured: CapturedPublish[] = [];
  const publish = mock((subject: string, payload: Uint8Array) => {
    if (opts?.failOnPublish) {
      throw new Error("nats publish boom");
    }
    const text = new TextDecoder().decode(payload);
    captured.push({ subject, body: JSON.parse(text) });
    return undefined;
  });
  const fakeNc = { publish } as unknown as NatsConnection;
  const publisher = new TenantReadyPublisher(fakeNc);
  return { publisher, captured, publish };
}

describe("TenantReadyPublisher", () => {
  it("emits a v1 message on TENANT_READY_SUBJECT with required fields", () => {
    const { publisher, captured, publish } = buildPublisher();
    publisher.publishTenantReady({ tenantId: "tid-1", name: "acme" });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    const event = captured[0]!;
    expect(event.subject).toBe(TENANT_READY_SUBJECT);
    expect(isTenantReadyMessageV1(event.body)).toBe(true);
    expect(event.body).toEqual({
      schemaVersion: 1,
      tenantId: "tid-1",
      name: "acme",
    });
  });

  it("includes tier metadata when provided", () => {
    const { publisher, captured } = buildPublisher();
    publisher.publishTenantReady({
      tenantId: "tid-1",
      name: "acme",
      tier: TenantDatabaseTier.Shared,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.body).toEqual({
      schemaVersion: 1,
      tenantId: "tid-1",
      name: "acme",
      tier: TenantDatabaseTier.Shared,
    });
  });

  it("does not include `tier` in the payload when omitted", () => {
    const { publisher, captured } = buildPublisher();
    publisher.publishTenantReady({ tenantId: "tid-1", name: "acme" });
    expect(
      Object.prototype.hasOwnProperty.call(captured[0]?.body ?? {}, "tier"),
    ).toBe(false);
  });

  it("swallows publish errors so a flaky NATS connection cannot fail the provision pipeline", () => {
    const { publisher, publish } = buildPublisher({ failOnPublish: true });
    expect(() =>
      publisher.publishTenantReady({ tenantId: "tid-1", name: "acme" }),
    ).not.toThrow();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
