// Bus-event classifier — implements TAXONOMY.md §4 rules 1-20, first-match-wins,
// over the subject string. Pure function, no side effects. Every rule branch
// cites the TAXONOMY.md rule number it implements.
//
// The canonical 8-token subject is parsed via `parseSubject` from `@yoizen/shared`
// (evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.<version>).
// Non-canonical subjects (dlq.*, rt.*, platform.tenant.*, audit.gateway.*,
// events.>, results.>) are matched by the rules directly.

import { parseSubject } from "@yoizen/shared";
import { err, ok, type Result } from "./result.js";

// tech dimension — TAXONOMY.md §2 (http source value maps to display value http-generic).
// The Meta channel tokens (`whatsapp`, `instagram`) left this union with the
// Meta channel decommission — no producer can emit them any more.
export type Tech =
  | "telegram"
  | "e2e-tests"
  | "http-generic"
  | "platform"
  | "runtime-stream"
  | "connector"
  | "tenant-lifecycle"
  | "gateway-audit"
  | "unknown";

// business_fn dimension — TAXONOMY.md §3.
export type BusinessFn =
  | "ingress"
  | "channel-processing"
  | "channel-egress"
  | "routing"
  | "agent-execution"
  | "agent-admin"
  | "agent-scheduling"
  | "agent-memory"
  | "agent-runtime-streaming"
  | "connector-invocation"
  | "llm-invocation"
  | "workflow-execution"
  | "runtime-presence"
  | "registry-sync"
  | "provisioning"
  | "secrets-audit"
  | "tenant-provisioning"
  | "audit"
  | "dlq"
  | "legacy"
  | "unknown";

export interface Classification {
  tech: Tech;
  businessFn: BusinessFn;
  /**
   * TAXONOMY.md §4 rule that fired (first-match-wins). 1-18 plus 19 (workflow)
   * and 20 (runtime-presence heartbeats — `counted-not-persisted` disposition).
   */
  rule: number;
  /** Rules 16/17/18 produce unrecognized traffic the consumer must alarm on. */
  unknown: boolean;
}

export interface ClassifyOptions {
  /** JetStream stream name; a `DLQ-` prefix short-circuits to rule 1. */
  streamName?: string;
}

// Channel token whitelist for the generic 8-token fallback (rule 17).
// Kept in step with the `Channel` union in @yoizen/shared plus the `platform`
// placeholder token; the Meta tokens went away with the Meta channel
// decommission, so a stray `whatsapp`/`instagram` subject now falls to
// `tech: unknown` here — which is the alarm rule 17 exists to raise.
const CHANNEL_WHITELIST = new Set([
  "telegram",
  "http",
  "e2e-tests",
  "platform",
]);

// Kinds that mark an outbound egress lifecycle event (rule 4).
const EGRESS_KINDS = new Set(["send", "sent", "delivered", "read", "failed"]);

// Kinds that mark an agent-execution lifecycle event under the ORIGINAL
// `ai-agent-gateway` producer token (rule 6). Frozen: every event persisted
// before the E3 migration (PENDIENTES/04-e3-subject.spec.md) rides this token,
// and so do the captured golden rows (seq 1246/1251/1260/1263/1271/1278/1279/1284).
const AGENT_EXECUTION_KINDS = new Set([
  "execution_requested",
  "execution_started",
  "execution_completed",
  "execution_failed",
]);

// The SUBSET of rule-6 kinds whose producer token moves from `ai-agent-gateway`
// to `agent-ai-service` in the E3 migration (PENDIENTES/04-e3-subject.spec.md
// T02) — the three lifecycle kinds actually published by agent-ai-service
// (`execution.handler.ts` / `job-executor.service.ts` `publishStatus`).
// `execution_requested` is DELIBERATELY absent: it is published by the gateway
// itself (`packages/shared/src/execution-client.ts`) with
// `producer: ai-agent-gateway`, subject and envelope already agree, and it does
// NOT move — an `agent-ai-service` `execution_requested` subject stays
// unrecognized (rule 16, the alarm).
const AGENT_EXECUTION_MOVED_KINDS = new Set([
  "execution_started",
  "execution_completed",
  "execution_failed",
]);

// Producer tokens accepted for the runtime-presence heartbeat (rule 20):
// `ai-agent-gateway` is the historical token (the lie recorded as DRIFT.md item
// 10) and `agent-ai-service` is the post-E3 truth. Both are accepted forever —
// the persisted history and the frozen golden set carry the old one.
const RUNTIME_PRESENCE_PRODUCERS = new Set([
  "ai-agent-gateway",
  "agent-ai-service",
]);

// Kinds that mark the connector-invoke async transport pair (rule 21).
const CONNECTOR_INVOKE_KINDS = new Set([
  "invoke_requested",
  "invoke_completed",
]);

// Kinds that mark the T05 secrets-audit trail (rule 23).
const SECRETS_AUDIT_KINDS = new Set([
  "secret_written",
  "secret_resolved",
  "secret_access_denied",
]);

// Kinds that mark an agent-memory lifecycle event (rule 9).
const AGENT_MEMORY_KINDS = new Set([
  "memory_proposed",
  "memory_published",
  "memory_rejected",
  "memory_expired",
]);

// Runtime-stream kinds (rule 12).
const RUNTIME_STREAM_KINDS = new Set([
  "token",
  "tool_call",
  "tool_result",
  "cancel",
]);

// Tenant-lifecycle subjects (rule 13).
const TENANT_LIFECYCLE_SUBJECTS = new Set([
  "platform.tenant.provision.requested",
  "platform.tenant.ready",
  "platform.tenant.deleted",
]);

/**
 * §2 Q5 rename: the source-code channel value `http` is presented as
 * `http-generic`; any other channel token passes through unchanged.
 */
function mapChannelToTech(channel: string): Tech {
  return (channel === "http" ? "http-generic" : channel) as Tech;
}

// Only the three catch-all rules mark traffic as unrecognized/alarm-worthy.
// Rule 19 (workflow-service) is a recognized canonical family even though its
// number is > 15, so `unknown` is an explicit set, not a `rule >= 16` test.
// Exported as the SINGLE SOURCE OF TRUTH for "is this rule an alarm?" — every
// consumer (classify + the T07 pipeline) tests membership here rather than
// re-deriving with `rule >= 16` (which mis-flags rule 19).
export const UNKNOWN_RULES: ReadonlySet<number> = new Set([16, 17, 18]);

// Rules whose disposition is `counted-not-persisted` (TAXONOMY.md §4 note): the
// message IS classified and counted (an OTel counter keeps it visible) but NO row
// is inserted. Rule 20 (`online.v1` runtime-presence heartbeats, under either
// producer token — see the rule branch) is the first such rule — a per-tenant liveness signal published every ~15s, not
// business traffic worth persisting. Exported as the SINGLE SOURCE OF TRUTH for
// the disposition so the T07 pipeline and consumer edge test membership here
// rather than hard-coding rule numbers.
export const SKIP_PERSIST_RULES: ReadonlySet<number> = new Set([20]);

function classified(
  tech: Tech,
  businessFn: BusinessFn,
  rule: number
): Classification {
  return { tech, businessFn, rule, unknown: UNKNOWN_RULES.has(rule) };
}

/**
 * Classifies a bus-event subject into `{ tech, businessFn, rule }` using the
 * ordered, deterministic rules in TAXONOMY.md §4. First match wins.
 */
export function classify(
  subject: string,
  options: ClassifyOptions = {}
): Result<Classification> {
  if (typeof subject !== "string" || subject.length === 0) {
    return err("subject must be a non-empty string");
  }

  const { streamName } = options;

  // Rule 1 — DLQ. Runs first because a DLQ subject embeds the original subject
  // as a suffix (`dlq.<tenant>.evt.<tenant>...`); a later rule would otherwise
  // mis-tag it. tech is inherited from the embedded original subject.
  // TAXONOMY.md §4 rule 1.
  if (
    (streamName && streamName.startsWith("DLQ-")) ||
    subject === "dlq.webhook" ||
    subject.startsWith("dlq.")
  ) {
    const parts = subject.split(".");
    const embedded = subject.startsWith("dlq.") ? parts.slice(2).join(".") : "";
    let inheritedTech: Tech = "unknown";
    if (embedded.length > 0) {
      const inner = classify(embedded);
      if (inner.ok) {
        inheritedTech = inner.value.tech;
      }
    }
    return ok(classified(inheritedTech, "dlq", 1));
  }

  const parsed = parseSubject(subject);

  if (parsed) {
    const { producer, domain, channel, provider, kind } = parsed;

    // Rule 2 — Stage-1 webhook receipt. TAXONOMY.md §4 rule 2.
    if (
      producer === "api-gateway" &&
      domain === "messaging" &&
      provider === "webhook" &&
      kind === "webhook_received"
    ) {
      return ok(classified(mapChannelToTech(channel), "ingress", 2));
    }

    // Rules 3-5 — channel-service messaging family. TAXONOMY.md §4 rules 3-5.
    if (producer === "channel-service" && domain === "messaging") {
      const tech = mapChannelToTech(channel);
      // Rule 3 — Stage-2 canonical received. TAXONOMY.md §4 rule 3.
      if (kind === "received") {
        return ok(classified(tech, "channel-processing", 3));
      }
      // Rule 4 — outbound egress lifecycle. TAXONOMY.md §4 rule 4.
      if (EGRESS_KINDS.has(kind)) {
        return ok(classified(tech, "channel-egress", 4));
      }
      // Rule 5 — any other channel-service kind (catch-all). TAXONOMY.md §4 rule 5.
      return ok(classified(tech, "channel-processing", 5));
    }

    // Rule 6 — agent execution lifecycle, DUAL producer token. TAXONOMY.md §4
    // rule 6.
    //
    // `ai-agent-gateway` = history: every lifecycle event published before the
    // E3 migration (PENDIENTES/04-e3-subject.spec.md) rides that token, and the
    // 92-event golden set is frozen on it, so it is accepted FOREVER.
    // `agent-ai-service` = post-E3 truth: the three moving kinds
    // (`execution_started/completed/failed`) are published by agent-ai-service,
    // whose subject token was lying with the gateway's name. Golden rule 3
    // (TAXONOMY.md §6, rule-21 precedent): the classifier learns the new token
    // BEFORE the emitter flips (T02), so no event is ever unclassified in
    // flight. `execution_requested` stays gateway-only — see
    // AGENT_EXECUTION_MOVED_KINDS.
    if (
      domain === "automation" &&
      channel === "platform" &&
      provider === "internal" &&
      ((producer === "ai-agent-gateway" && AGENT_EXECUTION_KINDS.has(kind)) ||
        (producer === "agent-ai-service" &&
          AGENT_EXECUTION_MOVED_KINDS.has(kind)))
    ) {
      return ok(classified("platform", "agent-execution", 6));
    }

    // Rule 7 — agent-admin-service lifecycle. TAXONOMY.md §4 rule 7.
    if (
      producer === "agent-admin-service" &&
      domain === "automation" &&
      channel === "platform" &&
      provider === "internal"
    ) {
      return ok(classified("platform", "agent-admin", 7));
    }

    // Rule 8 — agent-scheduler-service heartbeat/trigger. TAXONOMY.md §4 rule 8.
    if (
      producer === "agent-scheduler-service" &&
      domain === "automation" &&
      channel === "platform" &&
      provider === "internal"
    ) {
      return ok(classified("platform", "agent-scheduling", 8));
    }

    // Rule 9 — agent-memory lifecycle. Classified by SUBJECT (domain token
    // `agent-memory`), never envelope.domain. TAXONOMY.md §4 rule 9.
    // Pre-2026-07-31 envelopes reported `domain: "automation"` and contradicted
    // this subject; envelope-drift T08 aligned the body, but the subject stays
    // authoritative either way, so old and new rows classify identically.
    if (
      producer === "agent-memory-service" &&
      domain === "agent-memory" &&
      channel === "platform" &&
      provider === "internal" &&
      AGENT_MEMORY_KINDS.has(kind)
    ) {
      return ok(classified("platform", "agent-memory", 9));
    }

    // Rule 10 — registry-service lifecycle. TAXONOMY.md §4 rule 10.
    if (
      producer === "registry-service" &&
      domain === "platform" &&
      provider === "system"
    ) {
      return ok(classified("platform", "registry-sync", 10));
    }

    // Rule 23 — provisioning-service secrets-audit trail
    // (`manual-loops/declarative-provisioning.md` T05). SAME producer/
    // domain/channel/provider family as rule 22, but a DIFFERENT
    // business_fn (human decision, 2026-07-14) — secrets audit is a
    // distinct business concern from apply-run bookkeeping. MUST be
    // evaluated BEFORE rule 22 (kind-agnostic within the same family) or
    // these three kinds would silently get business_fn: provisioning
    // instead. Values NEVER appear in these events. TAXONOMY.md §4 rule 23.
    if (
      producer === "provisioning-service" &&
      domain === "provisioning" &&
      channel === "platform" &&
      provider === "internal" &&
      SECRETS_AUDIT_KINDS.has(kind)
    ) {
      return ok(classified("platform", "secrets-audit", 23));
    }

    // Rule 22 — provisioning-service apply-engine audit trail
    // (`manual-loops/declarative-provisioning.md` T04). Kind-agnostic within
    // the family (matches producer+domain, same design as rule 19): covers
    // `apply_started`/`resource_applied`/`apply_completed`/`apply_failed`.
    // Evaluated BEFORE the 16/17/18 catch-alls — rule 17's channel whitelist
    // already contains `platform`, so without this rule these events would
    // get the right tech by accident but business_fn would fall to rule 17's
    // `unknown` and alarm on every manifest apply. TAXONOMY.md §4 rule 22.
    if (
      producer === "provisioning-service" &&
      domain === "provisioning" &&
      channel === "platform" &&
      provider === "internal"
    ) {
      return ok(classified("platform", "provisioning", 22));
    }

    // Rule 21 — connector-runtime async invoke transport pair
    // (`invoke_requested`/`invoke_completed`, `manual-loops/connector-invoke-api.md`
    // T04). Evaluated BEFORE rule 11 — both match the same
    // `.connector-runtime.platform.endpoint.` subject family, and rule 11's
    // substring check has no kind whitelist, so it would otherwise shadow
    // these two kinds and mis-tag them `tech: connector` instead of the
    // intended `tech: platform` (transport/control-plane signaling,
    // mirroring the `ai-agent-gateway` execution_requested/completed
    // precedent, rule 6 — NOT the HTTP-call audit trail rule 11 covers).
    // TAXONOMY.md §4 rule 21.
    if (
      producer === "connector-runtime" &&
      domain === "platform" &&
      channel === "endpoint" &&
      provider === "system" &&
      CONNECTOR_INVOKE_KINDS.has(kind)
    ) {
      return ok(classified("platform", "connector-invocation", 21));
    }

    // Rule 11 — connector-runtime endpoint invocation. TAXONOMY.md §4 rule 11.
    if (subject.includes(".connector-runtime.platform.endpoint.")) {
      return ok(classified("connector", "connector-invocation", 11));
    }

    // Rule 24 — connector-runtime MCP tool-call audit trail
    // (`manual-loops/connectors/connection-call-inspector.md` T03/T05,
    // decision 7). SAME producer (`connector-runtime`) as rule 11's
    // `endpoint_call_completed`, but a DIFFERENT subject family — channel
    // token `mcp`, not `endpoint` — so rule 11's `.platform.endpoint.`
    // substring check never matches it; a dedicated rule is required or this
    // family falls through to rule 17 `unknown` (channel `mcp` is not in
    // CHANNEL_WHITELIST). `business_fn: connector-invocation` is REUSED
    // (not split into a new value, unlike rule 23's secrets-audit split from
    // rule 22): decision 1 of the SPEC explicitly groups `mcpCall` alongside
    // `endpointCall` as one of "every connector invocation type" on the same
    // connection-detail surface, so the same business concern applies.
    // `tech: connector` for the same reason — MCP servers are one of the
    // connector kinds enumerated in decision 1 ("HTTP connector, MCP server,
    // agent, hosted service"). TAXONOMY.md §4 rule 24.
    if (
      producer === "connector-runtime" &&
      domain === "platform" &&
      channel === "mcp" &&
      provider === "system" &&
      kind === "mcp_call_completed"
    ) {
      return ok(classified("connector", "connector-invocation", 24));
    }

    // Rule 25 — agent-ai-service standalone LLM call audit trail
    // (`manual-loops/connectors/connection-call-inspector.md` T04/T05,
    // decision 7). Producer `agent-ai-service`, domain `platform`, channel
    // `llm`, provider `system`, kind `llm_call_completed` — publishes ONLY
    // for LLM calls made OUTSIDE chat executions (the job-executor `llm_call`
    // action, `llm-action.service.ts`); chat executions already carry their
    // payload in rule 6's `execution_completed` and are explicitly excluded
    // by the emitter, so there is no double-classification risk. A NEW
    // `business_fn: llm-invocation` value (not reused from rule 6's
    // `agent-execution` or rule 11/24's `connector-invocation`): this is a
    // producer-intent decision (TAXONOMY.md §3 Q1) — the event represents a
    // standalone LLM invocation, a distinct business concern from a full
    // agent chat execution and from a connector-runtime HTTP/tool call, even
    // though `tech: platform` matches rule 6/19/20's "platform-to-platform"
    // convention (channel token `llm` is not the literal `platform`
    // placeholder, but the event is still internal platform traffic, not an
    // external HTTP adapter call). TAXONOMY.md §4 rule 25.
    if (
      producer === "agent-ai-service" &&
      domain === "platform" &&
      channel === "llm" &&
      provider === "system" &&
      kind === "llm_call_completed"
    ) {
      return ok(classified("platform", "llm-invocation", 25));
    }

    // Rule 19 — workflow-service execution lifecycle. Matches the canonical
    // family `evt.*.workflow-service.workflow.*` (producer token `workflow-service`
    // AND domain token `workflow`, e.g.
    // `evt.acme.workflow-service.workflow.internal.native.execution_completed.v1`).
    // Placed BEFORE the 16/17/18 catch-alls so it is reachable — its 5th token
    // `internal` is not in the channel whitelist and would otherwise fall to
    // rule 17 `unknown`. tech `platform` per §2 (Temporal is a runtime detail
    // absent from the subject).
    //
    // Deliberately kind-agnostic (unlike rule 6's AGENT_EXECUTION_KINDS or rule
    // 9's AGENT_MEMORY_KINDS enums): matching on (producer, domain) alone covers
    // run-level kinds (`execution_started`, `execution_completed`) AND the
    // step-level telemetry kinds added by `manual-loops/workflow-step-events.md`
    // T01 (`action_started`, `action_completed`, `condition_evaluated`) with NO
    // kind enum, because every kind in this family represents the same
    // workflow-execution business function. TAXONOMY.md §4 rule 19.
    if (producer === "workflow-service" && domain === "workflow") {
      return ok(classified("platform", "workflow-execution", 19));
    }

    // Rule 20 — `online.v1` runtime-presence heartbeat, DUAL producer token. A
    // per-tenant liveness signal (published every ~15s by agent-ai-service's
    // HeartbeatService, `services/agent-ai-service/src/modules/heartbeat/
    // heartbeat.service.ts:91`), NOT business traffic. Disposition
    // `counted-not-persisted` (TAXONOMY.md §4 note + SKIP_PERSIST_RULES): counted
    // via an OTel metric, no row inserted — UNCHANGED by the token move.
    // Evaluated BEFORE the rule-16 catch-all — which would otherwise tag it
    // `unknown` and alarm — exactly like rule 19.
    // Historically the subject's producer token was `ai-agent-gateway` while the
    // publisher was agent-ai-service — the producer-token drift tracked as
    // DRIFT.md item 10, analogous to DRIFT.md item 9 (agent-memory
    // envelope.producer drift). The E3 migration
    // (PENDIENTES/04-e3-subject.spec.md) corrects the subject to
    // `agent-ai-service`; both tokens are accepted here (same dual-token
    // reasoning as rule 6 above: the old token is frozen in the persisted
    // history and in the golden set — seq 1249/1255/1256/1267/1288-1307 — and
    // the new one lands ahead of the T02 emitter per golden rule 3). The
    // heartbeat's other non-canonical traits (no `data.payload_inline`, a
    // `{name,version}` transport) are DRIFT.md item 5 and are untouched here.
    // TAXONOMY.md §4 rule 20.
    if (
      RUNTIME_PRESENCE_PRODUCERS.has(producer) &&
      domain === "automation" &&
      channel === "platform" &&
      provider === "internal" &&
      kind === "online"
    ) {
      return ok(classified("platform", "runtime-presence", 20));
    }

    // Rule 16 — any other internal-agent producer with the
    // automation/platform/internal shape (catch-all). Flagged unknown for
    // manual review. TAXONOMY.md §4 rule 16.
    if (
      domain === "automation" &&
      channel === "platform" &&
      provider === "internal"
    ) {
      return ok(classified("platform", "unknown", 16));
    }

    // Rule 17 — generic canonical 8-token shape not enumerated above. tech is
    // the 5th token when it is a known channel, else unknown. Flagged unknown.
    // TAXONOMY.md §4 rule 17.
    const tech = CHANNEL_WHITELIST.has(channel)
      ? mapChannelToTech(channel)
      : "unknown";
    return ok(classified(tech, "unknown", 17));
  }

  // --- Non-canonical subject families (subject does not parse as 8-token) ---

  // Rule 11 — connector-runtime marker may appear on a non-8-token subject too.
  // TAXONOMY.md §4 rule 11.
  if (subject.includes(".connector-runtime.platform.endpoint.")) {
    return ok(classified("connector", "connector-invocation", 11));
  }

  // Rule 12 — runtime-stream ephemeral streaming (`rt.<tenant>.exec.<id>.<kind>`).
  // TAXONOMY.md §4 rule 12.
  {
    const parts = subject.split(".");
    if (
      parts[0] === "rt" &&
      parts[2] === "exec" &&
      parts.length >= 5 &&
      RUNTIME_STREAM_KINDS.has(parts[parts.length - 1])
    ) {
      return ok(classified("runtime-stream", "agent-runtime-streaming", 12));
    }
  }

  // Rule 13 — tenant-lifecycle control plane. TAXONOMY.md §4 rule 13.
  if (TENANT_LIFECYCLE_SUBJECTS.has(subject)) {
    return ok(classified("tenant-lifecycle", "tenant-provisioning", 13));
  }

  // Rule 14 — cross-tenant gateway audit stream. TAXONOMY.md §4 rule 14.
  if (
    subject === "audit.gateway.request" ||
    subject.startsWith("audit.gateway.")
  ) {
    return ok(classified("gateway-audit", "audit", 14));
  }

  // Rule 15 — deprecated flat EVENTS/RESULTS streams (D13). TAXONOMY.md §4 rule 15.
  if (subject.startsWith("events.") || subject.startsWith("results.")) {
    return ok(classified("unknown", "legacy", 15));
  }

  // Rule 18 — deterministic fallback: no pattern matched. Flagged unknown.
  // TAXONOMY.md §4 rule 18.
  return ok(classified("unknown", "unknown", 18));
}
