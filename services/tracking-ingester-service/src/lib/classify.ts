// Bus-event classifier — implements TAXONOMY.md §4 rules 1-19, first-match-wins,
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
export type Tech =
  | "whatsapp"
  | "instagram"
  | "telegram"
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
  | "workflow-execution"
  | "registry-sync"
  | "tenant-provisioning"
  | "audit"
  | "dlq"
  | "legacy"
  | "unknown";

export interface Classification {
  tech: Tech;
  businessFn: BusinessFn;
  /** TAXONOMY.md §4 rule that fired (first-match-wins). 1-18 plus 19 (workflow). */
  rule: number;
  /** Rules 16/17/18 produce unrecognized traffic the consumer must alarm on. */
  unknown: boolean;
}

export interface ClassifyOptions {
  /** JetStream stream name; a `DLQ-` prefix short-circuits to rule 1. */
  streamName?: string;
}

// Channel token whitelist for the generic 8-token fallback (rule 17).
const CHANNEL_WHITELIST = new Set([
  "whatsapp",
  "instagram",
  "telegram",
  "http",
  "platform",
]);

// Kinds that mark an outbound egress lifecycle event (rule 4).
const EGRESS_KINDS = new Set(["send", "sent", "delivered", "read", "failed"]);

// Kinds that mark an agent-execution lifecycle event (rule 6).
const AGENT_EXECUTION_KINDS = new Set([
  "execution_requested",
  "execution_started",
  "execution_completed",
  "execution_failed",
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

    // Rule 6 — ai-agent-gateway execution lifecycle. TAXONOMY.md §4 rule 6.
    if (
      producer === "ai-agent-gateway" &&
      domain === "automation" &&
      channel === "platform" &&
      provider === "internal" &&
      AGENT_EXECUTION_KINDS.has(kind)
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
    // `agent-memory`), not envelope.domain (which is `automation`). TAXONOMY.md §4 rule 9.
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

    // Rule 11 — connector-runtime endpoint invocation. TAXONOMY.md §4 rule 11.
    if (subject.includes(".connector-runtime.platform.endpoint.")) {
      return ok(classified("connector", "connector-invocation", 11));
    }

    // Rule 19 — workflow-service execution lifecycle. Matches the canonical
    // family `evt.*.workflow-service.workflow.*` (producer token `workflow-service`
    // AND domain token `workflow`, e.g.
    // `evt.acme.workflow-service.workflow.internal.native.execution_completed.v1`).
    // Placed BEFORE the 16/17/18 catch-alls so it is reachable — its 5th token
    // `internal` is not in the channel whitelist and would otherwise fall to
    // rule 17 `unknown`. tech `platform` per §2 (Temporal is a runtime detail
    // absent from the subject). TAXONOMY.md §4 rule 19.
    if (producer === "workflow-service" && domain === "workflow") {
      return ok(classified("platform", "workflow-execution", 19));
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
