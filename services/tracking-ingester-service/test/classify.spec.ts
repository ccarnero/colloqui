import { describe, expect, it } from "bun:test";
import { classify } from "../src/lib/classify.js";

function value(subject: string, streamName?: string) {
  const r = classify(subject, streamName ? { streamName } : {});
  if (!r.ok) {
    throw new Error(`unexpected err: ${r.error}`);
  }
  return r.value;
}

describe("classify — TAXONOMY.md §4 rules 1-18", () => {
  it("rejects an empty subject", () => {
    const r = classify("");
    expect(r.ok).toBe(false);
  });

  it("rule 1 — DLQ by stream name inherits embedded tech", () => {
    const c = value(
      "dlq.acme.evt.acme.channel-service.messaging.telegram.telegram.received.v1",
      "DLQ-acme"
    );
    expect(c).toMatchObject({ tech: "telegram", businessFn: "dlq", rule: 1 });
  });

  it("rule 1 — dlq.webhook has no embedded subject → unknown tech", () => {
    const c = value("dlq.webhook");
    expect(c).toMatchObject({ tech: "unknown", businessFn: "dlq", rule: 1 });
  });

  it("rule 1 — dlq.<tenant>.> embedding a platform subject inherits platform", () => {
    const c = value(
      "dlq.acme.evt.acme.ai-agent-gateway.automation.platform.internal.execution_requested.v1"
    );
    expect(c).toMatchObject({ tech: "platform", businessFn: "dlq", rule: 1 });
  });

  it("rule 2 — webhook ingress (telegram)", () => {
    const c = value(
      "evt.acme.api-gateway.messaging.telegram.webhook.webhook_received.v1"
    );
    expect(c).toMatchObject({
      tech: "telegram",
      businessFn: "ingress",
      rule: 2,
    });
  });

  it("rule 2 — webhook ingress maps http → http-generic", () => {
    const c = value(
      "evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1"
    );
    expect(c.tech).toBe("http-generic");
    expect(c.rule).toBe(2);
  });

  it("rule 3 — channel-service received", () => {
    const c = value(
      "evt.acme.channel-service.messaging.telegram.telegram.received.v1"
    );
    expect(c).toMatchObject({
      tech: "telegram",
      businessFn: "channel-processing",
      rule: 3,
    });
  });

  it("rule 4 — channel-service egress (send/sent/delivered/read/failed)", () => {
    for (const kind of ["send", "sent", "delivered", "read", "failed"]) {
      const c = value(
        `evt.acme.channel-service.messaging.telegram.telegram.${kind}.v1`
      );
      expect(c).toMatchObject({
        tech: "telegram",
        businessFn: "channel-egress",
        rule: 4,
      });
    }
  });

  it("rule 5 — channel-service catch-all kind", () => {
    const c = value(
      "evt.acme.channel-service.messaging.whatsapp.meta.status_update.v1"
    );
    expect(c).toMatchObject({
      tech: "whatsapp",
      businessFn: "channel-processing",
      rule: 5,
    });
  });

  it("rule 6 — ai-agent-gateway execution lifecycle", () => {
    for (const kind of [
      "execution_requested",
      "execution_started",
      "execution_completed",
      "execution_failed",
    ]) {
      const c = value(
        `evt.acme.ai-agent-gateway.automation.platform.internal.${kind}.v1`
      );
      expect(c).toMatchObject({
        tech: "platform",
        businessFn: "agent-execution",
        rule: 6,
      });
    }
  });

  it("rule 7 — agent-admin-service lifecycle", () => {
    const c = value(
      "evt.acme.agent-admin-service.automation.platform.internal.config_sync.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "agent-admin",
      rule: 7,
    });
  });

  it("rule 8 — agent-scheduler-service heartbeat", () => {
    const c = value(
      "evt.acme.agent-scheduler-service.automation.platform.internal.heartbeat.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "agent-scheduling",
      rule: 8,
    });
  });

  it("rule 9 — agent-memory lifecycle (classified by subject domain token)", () => {
    for (const kind of [
      "memory_proposed",
      "memory_published",
      "memory_rejected",
      "memory_expired",
    ]) {
      const c = value(
        `evt.acme.agent-memory-service.agent-memory.platform.internal.${kind}.v1`
      );
      expect(c).toMatchObject({
        tech: "platform",
        businessFn: "agent-memory",
        rule: 9,
      });
    }
  });

  it("rule 10 — registry-service lifecycle", () => {
    const c = value(
      "evt.acme.registry-service.platform.service.system.service_upserted.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "registry-sync",
      rule: 10,
    });
  });

  it("rule 11 — connector-runtime endpoint invocation (canonical)", () => {
    const c = value(
      "evt.acme.connector-runtime.platform.endpoint.internal.invoked.v1"
    );
    expect(c).toMatchObject({
      tech: "connector",
      businessFn: "connector-invocation",
      rule: 11,
    });
  });

  it("rule 12 — runtime-stream ephemeral streaming", () => {
    for (const kind of ["token", "tool_call", "tool_result", "cancel"]) {
      const c = value(`rt.acme.exec.019f48b3.${kind}`);
      expect(c).toMatchObject({
        tech: "runtime-stream",
        businessFn: "agent-runtime-streaming",
        rule: 12,
      });
    }
  });

  it("rule 13 — tenant lifecycle control plane", () => {
    for (const subject of [
      "platform.tenant.provision.requested",
      "platform.tenant.ready",
      "platform.tenant.deleted",
    ]) {
      const c = value(subject);
      expect(c).toMatchObject({
        tech: "tenant-lifecycle",
        businessFn: "tenant-provisioning",
        rule: 13,
      });
    }
  });

  it("rule 14 — gateway audit stream", () => {
    const c = value("audit.gateway.request");
    expect(c).toMatchObject({
      tech: "gateway-audit",
      businessFn: "audit",
      rule: 14,
    });
  });

  it("rule 15 — deprecated flat events/results streams", () => {
    expect(value("events.acme.something").businessFn).toBe("legacy");
    expect(value("results.acme.something").rule).toBe(15);
    expect(value("events.acme.something").tech).toBe("unknown");
  });

  it("rule 16 — other automation/platform/internal producer → unknown flagged", () => {
    const c = value(
      "evt.acme.ai-agent-gateway.automation.platform.internal.online.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "unknown",
      rule: 16,
    });
    expect(c.unknown).toBe(true);
  });

  it("rule 17 — generic 8-token, channel not whitelisted → unknown flagged", () => {
    const c = value(
      "evt.acme.workflow-service.workflow.internal.native.execution_completed.v1"
    );
    expect(c).toMatchObject({
      tech: "unknown",
      businessFn: "unknown",
      rule: 17,
    });
    expect(c.unknown).toBe(true);
  });

  it("rule 17 — generic 8-token, whitelisted channel keeps tech", () => {
    const c = value(
      "evt.acme.some-producer.some-domain.whatsapp.meta.some_kind.v1"
    );
    expect(c).toMatchObject({
      tech: "whatsapp",
      businessFn: "unknown",
      rule: 17,
    });
  });

  it("rule 18 — fallback for unrecognized non-canonical subject", () => {
    const c = value("totally.unrecognized.subject");
    expect(c).toMatchObject({
      tech: "unknown",
      businessFn: "unknown",
      rule: 18,
    });
    expect(c.unknown).toBe(true);
  });
});
