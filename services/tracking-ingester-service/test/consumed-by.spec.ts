import { describe, expect, it } from "bun:test";
import { consumedBy } from "../src/lib/consumed-by.js";

function value(subject: string): readonly string[] {
  const r = consumedBy(subject);
  if (!r.ok) {
    throw new Error(`unexpected err: ${r.error}`);
  }
  return r.value;
}

describe("consumedBy — TAXONOMY.md §5 facet", () => {
  it("rejects an empty subject", () => {
    const r = consumedBy("");
    expect(r.ok).toBe(false);
  });

  it("§5 row 1 — channel received.v1 → four durable consumers", () => {
    expect(
      value("evt.acme.channel-service.messaging.telegram.telegram.received.v1")
    ).toEqual([
      "workflow-service",
      "audit-service",
      "usage-aggregator-service",
      "agent-ai-service",
    ]);
  });

  it("§5 row 2 — channel send.v1 → channel-egress + audit sink", () => {
    expect(
      value("evt.acme.channel-service.messaging.whatsapp.meta.send.v1")
    ).toEqual(["channel-service", "audit-service"]);
  });

  it("§5 row 3 — sent/delivered/read/failed → audit + usage aggregator", () => {
    for (const kind of ["sent", "delivered", "read", "failed"]) {
      expect(
        value(`evt.acme.channel-service.messaging.whatsapp.meta.${kind}.v1`)
      ).toEqual(["audit-service", "usage-aggregator-service"]);
    }
  });

  it("§5 row 4 — webhook_received → channel-service ingress durable", () => {
    expect(
      value(
        "evt.acme.api-gateway.messaging.telegram.webhook.webhook_received.v1"
      )
    ).toEqual(["channel-service"]);
  });

  it("§5 row 5 — registry service.system → connector-admin", () => {
    expect(
      value(
        "evt.acme.registry-service.platform.service.system.service_upserted.v1"
      )
    ).toEqual(["connector-admin"]);
  });

  it("§5 row 6 — agent-admin automation → agent-ai + agent-admin", () => {
    expect(
      value(
        "evt.acme.agent-admin-service.automation.platform.internal.config_sync.v1"
      )
    ).toEqual(["agent-ai-service", "agent-admin-service"]);
  });

  it("§5 row 6 — ai-agent-gateway automation → agent-ai + agent-admin", () => {
    expect(
      value(
        "evt.acme.ai-agent-gateway.automation.platform.internal.execution_requested.v1"
      )
    ).toEqual(["agent-ai-service", "agent-admin-service"]);
  });

  it("§5 row 7 — dlq.<tenant>.> → usage-aggregator-service", () => {
    expect(
      value(
        "dlq.acme.evt.acme.channel-service.messaging.telegram.telegram.received.v1"
      )
    ).toEqual(["usage-aggregator-service"]);
    // Legacy global `dlq.webhook` has no durable service consumer
    // (service-bus.md:99, "Consumer: ops/manual replay") → empty facet.
    expect(value("dlq.webhook")).toEqual([]);
  });

  it("§5 row 8 — audit.gateway.> → audit-service", () => {
    expect(value("audit.gateway.request")).toEqual(["audit-service"]);
  });

  it("§5 row 9 — tenant provision request → tenant-service", () => {
    expect(value("platform.tenant.provision.requested")).toEqual([
      "tenant-service",
    ]);
  });

  it("unknown subject families return an empty facet, not an error", () => {
    expect(
      value("evt.acme.some-new-service.automation.platform.internal.foo.v1")
    ).toEqual([]);
    expect(value("events.legacy.something")).toEqual([]);
    expect(value("rt.acme.exec.abc.token")).toEqual([]);
  });
});
