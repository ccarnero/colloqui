import { describe, expect, it } from "bun:test";
import { classify } from "../src/lib/classify.js";

function value(subject: string, streamName?: string) {
  const r = classify(subject, streamName ? { streamName } : {});
  if (!r.ok) {
    throw new Error(`unexpected err: ${r.error}`);
  }
  return r.value;
}

describe("classify — TAXONOMY.md §4 rules 1-20", () => {
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
    // A genuinely unrecognized internal-agent producer (NOT the online.v1
    // heartbeat, which is now rule 20) with the automation/platform/internal
    // shape falls to the rule-16 catch-all and IS the alarm.
    const c = value(
      "evt.acme.some-new-agent.automation.platform.internal.some_event.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "unknown",
      rule: 16,
    });
    expect(c.unknown).toBe(true);
  });

  it("rule 20 — ai-agent-gateway online.v1 runtime-presence heartbeat", () => {
    const c = value(
      "evt.acme.ai-agent-gateway.automation.platform.internal.online.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "runtime-presence",
      rule: 20,
    });
    // counted-not-persisted disposition — recognized, so NOT the unknown alarm.
    expect(c.unknown).toBe(false);
  });

  it("rule 20 — ordering: evaluated before the rule-16 catch-all", () => {
    const c = value(
      "evt.acme.ai-agent-gateway.automation.platform.internal.online.v1"
    );
    expect(c.rule).toBe(20);
    expect(c.rule).not.toBe(16);
  });

  it("rule 20 — near-miss: same shape but kind != online falls through as before", () => {
    // A different ai-agent-gateway automation/platform/internal kind (not in the
    // rule-6 execution enum and not `online`) must NOT match rule 20; it falls to
    // the rule-16 catch-all → unknown, exactly as before this rule existed.
    const c = value(
      "evt.acme.ai-agent-gateway.automation.platform.internal.offline.v1"
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
      "evt.acme.some-producer.some-domain.internal.native.some_kind.v1"
    );
    expect(c).toMatchObject({
      tech: "unknown",
      businessFn: "unknown",
      rule: 17,
    });
    expect(c.unknown).toBe(true);
  });

  it("rule 19 — workflow-service execution family → platform/workflow-execution", () => {
    const c = value(
      "evt.acme.workflow-service.workflow.internal.native.execution_completed.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "workflow-execution",
      rule: 19,
    });
    // Recognized family — must NOT be flagged for the unknown alarm.
    expect(c.unknown).toBe(false);
  });

  it("rule 19 — ordering: evaluated before the 16/17/18 catch-alls", () => {
    const c = value(
      "evt.acme.workflow-service.workflow.internal.native.execution_completed.v1"
    );
    expect(c.rule).toBe(19);
    expect(c.rule).not.toBe(16);
    expect(c.rule).not.toBe(17);
  });

  // workflow-step-events T01: rule 19 is kind-agnostic (matches on
  // producer+domain, not an explicit kind enum), so every step-event kind
  // added by manual-loops/workflow-step-events.md must already classify as
  // rule 19 platform/workflow-execution with no classifier code change.
  it("rule 19 — execution_started (step-events T01) → platform/workflow-execution", () => {
    const c = value(
      "evt.acme.workflow-service.workflow.internal.native.execution_started.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "workflow-execution",
      rule: 19,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 19 — action_started (step-events T01) → platform/workflow-execution", () => {
    const c = value(
      "evt.acme.workflow-service.workflow.internal.native.action_started.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "workflow-execution",
      rule: 19,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 19 — action_completed (step-events T01) → platform/workflow-execution", () => {
    const c = value(
      "evt.acme.workflow-service.workflow.internal.native.action_completed.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "workflow-execution",
      rule: 19,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 19 — condition_evaluated (step-events T01) → platform/workflow-execution", () => {
    const c = value(
      "evt.acme.workflow-service.workflow.internal.native.condition_evaluated.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "workflow-execution",
      rule: 19,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 19 — near-miss: producer workflow-service but domain != workflow falls through", () => {
    // domain token is `messaging`, not `workflow` → rule 19 must NOT fire;
    // it falls to the generic rule 17 (channel `whatsapp` is whitelisted).
    const c = value(
      "evt.acme.workflow-service.messaging.whatsapp.meta.some_kind.v1"
    );
    expect(c).toMatchObject({
      tech: "whatsapp",
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
