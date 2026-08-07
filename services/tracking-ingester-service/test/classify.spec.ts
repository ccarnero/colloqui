import { describe, expect, it } from "bun:test";
import { classify, SKIP_PERSIST_RULES } from "../src/lib/classify.js";

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

  // E3 migration (PENDIENTES/04-e3-subject.spec.md T01): the three lifecycle
  // kinds actually published by agent-ai-service move their producer token from
  // `ai-agent-gateway` to `agent-ai-service`. The classifier learns the new
  // token AHEAD of the emitter (golden rule 3) and keeps the old one forever —
  // the case above is the frozen history and must never be relaxed.
  it("rule 6 — agent-ai-service execution lifecycle (E3 new producer token)", () => {
    // Subjects spelled out in full (not built from a kind template): these are
    // wire strings, and the point of the case is that the exact post-E3 subject
    // classifies identically to its old-token twin.
    for (const subject of [
      "evt.acme.agent-ai-service.automation.platform.internal.execution_started.v1",
      "evt.acme.agent-ai-service.automation.platform.internal.execution_completed.v1",
      "evt.acme.agent-ai-service.automation.platform.internal.execution_failed.v1",
    ]) {
      const c = value(subject);
      expect(c).toMatchObject({
        tech: "platform",
        businessFn: "agent-execution",
        rule: 6,
      });
      expect(c.unknown).toBe(false);
    }
  });

  it("rule 6 — execution_requested does NOT move: agent-ai-service token falls to rule 16", () => {
    // `execution_requested` is published by the gateway itself
    // (`packages/shared/src/execution-client.ts`) and stays on the
    // `ai-agent-gateway` token. An `agent-ai-service` execution_requested
    // subject is therefore NOT a recognized family — it must reach the rule-16
    // catch-all and alarm, so a future mistaken emitter is visible.
    const c = value(
      "evt.acme.agent-ai-service.automation.platform.internal.execution_requested.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "unknown",
      rule: 16,
    });
    expect(c.unknown).toBe(true);
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

  // T05 of connection-call-inspector.md: `endpoint_call_completed` is now
  // ALSO published by serviceCall (resource `service/<name>`) and the raw
  // no-adapter branch (resource `raw/<host>`) — same subject family, same
  // rule. `classify` only reads the subject, never `envelope.resource`, so
  // the new resource prefixes classify identically to the pre-existing
  // `adapter/<id>` shape; this test guards that invariant explicitly.
  it("rule 11 — endpoint_call_completed classifies the same regardless of resource prefix (serviceCall/raw)", () => {
    const c = value(
      "evt.acme.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1"
    );
    expect(c).toMatchObject({
      tech: "connector",
      businessFn: "connector-invocation",
      rule: 11,
    });
  });

  it("rule 24 — connector-runtime mcp_call_completed -> connector/connector-invocation", () => {
    const c = value(
      "evt.acme.connector-runtime.platform.mcp.system.mcp_call_completed.v1"
    );
    expect(c).toMatchObject({
      tech: "connector",
      businessFn: "connector-invocation",
      rule: 24,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 24 — near-miss: endpoint channel does not match the mcp rule", () => {
    const c = value(
      "evt.acme.connector-runtime.platform.endpoint.system.mcp_call_completed.v1"
    );
    expect(c.rule).not.toBe(24);
  });

  it("rule 25 — agent-ai-service llm_call_completed -> platform/llm-invocation", () => {
    const c = value(
      "evt.acme.agent-ai-service.platform.llm.system.llm_call_completed.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "llm-invocation",
      rule: 25,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 25 — near-miss: wrong kind on the same family falls through to rule 17", () => {
    const c = value(
      "evt.acme.agent-ai-service.platform.llm.system.some_other_kind.v1"
    );
    expect(c).toMatchObject({
      tech: "unknown",
      businessFn: "unknown",
      rule: 17,
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

  // E3 migration (PENDIENTES/04-e3-subject.spec.md T01): the heartbeat subject
  // stops lying about its producer. Both tokens classify identically, and the
  // `counted-not-persisted` disposition is unchanged by the move.
  it("rule 20 — agent-ai-service online.v1 runtime-presence heartbeat (E3 new producer token)", () => {
    const c = value(
      "evt.acme.agent-ai-service.automation.platform.internal.online.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "runtime-presence",
      rule: 20,
    });
    expect(c.unknown).toBe(false);
    expect(SKIP_PERSIST_RULES.has(c.rule)).toBe(true);
  });

  it("rule 20 — new-token ordering: evaluated before the rule-16 catch-all", () => {
    const c = value(
      "evt.acme.agent-ai-service.automation.platform.internal.online.v1"
    );
    expect(c.rule).toBe(20);
    expect(c.rule).not.toBe(16);
  });

  it("rule 20 — new-token near-miss: kind != online still falls to rule 16", () => {
    // Widening rule 20 to the `agent-ai-service` token must not widen it to any
    // OTHER kind under that token: `offline` is neither a rule-6 execution kind
    // nor `online`, so it stays the rule-16 alarm exactly like its gateway twin.
    const c = value(
      "evt.acme.agent-ai-service.automation.platform.internal.offline.v1"
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

  it("rule 22 — provisioning-service apply_started -> platform/provisioning", () => {
    const c = value(
      "evt.acme.provisioning-service.provisioning.platform.internal.apply_started.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "provisioning",
      rule: 22,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 22 — provisioning-service resource_applied -> platform/provisioning", () => {
    const c = value(
      "evt.acme.provisioning-service.provisioning.platform.internal.resource_applied.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "provisioning",
      rule: 22,
    });
  });

  it("rule 22 — provisioning-service apply_completed -> platform/provisioning", () => {
    const c = value(
      "evt.acme.provisioning-service.provisioning.platform.internal.apply_completed.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "provisioning",
      rule: 22,
    });
  });

  it("rule 22 — provisioning-service apply_failed -> platform/provisioning", () => {
    const c = value(
      "evt.acme.provisioning-service.provisioning.platform.internal.apply_failed.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "provisioning",
      rule: 22,
    });
  });

  it("rule 22 — kind-agnostic within the family (unknown future kind still matches)", () => {
    const c = value(
      "evt.acme.provisioning-service.provisioning.platform.internal.some_future_kind.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "provisioning",
      rule: 22,
    });
    expect(c.unknown).toBe(false);
  });

  it("rule 22 — near-miss: domain != provisioning falls through to rule 17", () => {
    const c = value(
      "evt.acme.provisioning-service.automation.platform.internal.apply_started.v1"
    );
    expect(c).toMatchObject({
      tech: "platform",
      businessFn: "unknown",
      rule: 16,
    });
  });
});
