// `consumed_by` facet — TAXONOMY.md §5. Given a bus-event subject, returns the
// durable-consumer services that read that subject family (Postgres `text[]`).
// Pure function, no side effects, first-match-wins over the subject shape.
//
// Seed data is grounded in the durable-consumer registry documented in
// TAXONOMY.md §5, which itself derives the `received`/`send`/`sent` rows from
// `services/admin-console/src/app/features/processes/trace/domain/transport-topology.ts`
// (the hand-maintained pub/sub registry). That file lives inside the Angular
// admin-console app and imports its own `./message-trace.model` types, so it
// cannot be imported cleanly into this backend service; the minimal seed is
// mirrored here with the §5 rows and evidence citations. See task report.

import {
  GATEWAY_AUDIT_SUBJECT,
  parseSubject,
  TENANT_PROVISION_REQUESTED_SUBJECT,
} from "@yoizen/shared";
import { err, ok, type Result } from "./result.js";

// Kinds whose egress confirmation is read only by the audit sink + usage
// aggregator (TAXONOMY.md §5 row 3: sent/delivered/read/failed).
const EGRESS_CONFIRMATION_KINDS = new Set([
  "sent",
  "delivered",
  "read",
  "failed",
]);

// TAXONOMY.md §5 row 1 — `channel-service.messaging.*.*.received.v1`.
// transport-topology.ts:14-17 (workflow-triggers, channel-audit) plus
// service-bus.md:214 (usage-aggregator-service) and envelope-parser.ts
// (agent-ai-service durable `agent-ai-service-consumer`).
const RECEIVED_CONSUMERS: readonly string[] = [
  "workflow-service",
  "audit-service",
  "usage-aggregator-service",
  "agent-ai-service",
];

// TAXONOMY.md §5 row 2 — `channel-service.messaging.*.*.send.v1`.
// transport-topology.ts:19-22 (channel-egress producer + channel-audit sink).
const SEND_CONSUMERS: readonly string[] = ["channel-service", "audit-service"];

// TAXONOMY.md §5 row 3 — sent/delivered/read/failed egress confirmations.
// transport-topology.ts:26-28 (channel-audit) + envelope-parser.ts
// KIND_TO_DIRECTION (usage-aggregator-service).
const EGRESS_CONFIRMATION_CONSUMERS: readonly string[] = [
  "audit-service",
  "usage-aggregator-service",
];

// TAXONOMY.md §5 row 4 — `api-gateway.messaging.*.webhook.webhook_received.v1`.
// docs/messaging/ingress.md:97-107 (durable `channel-webhook-ingress`).
const WEBHOOK_INGRESS_CONSUMERS: readonly string[] = ["channel-service"];

// TAXONOMY.md §5 row 5 — `registry-service.platform.service.system.*.v1`.
// internal-sync.service.ts:109-155 (durable `adapter-internal-sync`).
const REGISTRY_CONSUMERS: readonly string[] = ["connector-admin"];

// TAXONOMY.md §5 row 6 — `{agent-admin-service,ai-agent-gateway}.automation.
// platform.internal.*.v1`. ingress.md:241 + service-bus.md:214,310
// (agent-ai-service `agent-ai-service-consumer`, agent-admin-service `skb-ingestion-worker`).
const AGENT_AUTOMATION_CONSUMERS: readonly string[] = [
  "agent-ai-service",
  "agent-admin-service",
];

// TAXONOMY.md §5 row 7 — `dlq.<tenant>.>` (service-bus.md:93).
const DLQ_CONSUMERS: readonly string[] = ["usage-aggregator-service"];

// TAXONOMY.md §5 row 8 — `audit.gateway.>` (constants.ts:84, durable `gateway-audit-writer`).
const GATEWAY_AUDIT_CONSUMERS: readonly string[] = ["audit-service"];

// TAXONOMY.md §5 row 9 — `platform.tenant.provision.requested` (tenant-events.ts:42).
const TENANT_PROVISION_CONSUMERS: readonly string[] = ["tenant-service"];

/**
 * Returns the durable consumers that read a subject family, per TAXONOMY.md §5.
 * Unknown subject families return an empty facet (`ok([])`) — a valid state the
 * `text[]` column records as "no known consumers", never an error. Only a
 * missing/empty subject is an expected failure.
 */
export function consumedBy(subject: string): Result<readonly string[]> {
  if (typeof subject !== "string" || subject.length === 0) {
    return err("subject must be a non-empty string");
  }

  // §5 row 7 — per-tenant DLQ family only (matched before parsing; DLQ subjects
  // are non-8-token and embed the original subject as a suffix). Matches the
  // `dlq.<tenant>.>` shape from `buildDlqSubjectPattern` (channel.constants.ts:89),
  // i.e. a `dlq.` prefix with at least three tokens (`dlq.<tenant>.<...>`);
  // evidence service-bus.md:91-93 (Consumer: usage-aggregator-service). The
  // legacy global `dlq.webhook` (two tokens) is deliberately NOT matched — it has
  // no durable service consumer (service-bus.md:96-99, "ops/manual replay") and
  // falls through to `ok([])`.
  if (subject.startsWith("dlq.") && subject.split(".").length >= 3) {
    return ok(DLQ_CONSUMERS);
  }

  const parsed = parseSubject(subject);
  if (parsed) {
    const { producer, domain, channel: _channel, provider, kind } = parsed;

    // §5 row 4 — stage-1 webhook receipt.
    if (
      producer === "api-gateway" &&
      domain === "messaging" &&
      provider === "webhook" &&
      kind === "webhook_received"
    ) {
      return ok(WEBHOOK_INGRESS_CONSUMERS);
    }

    // §5 rows 1-3 — channel-service messaging family.
    if (producer === "channel-service" && domain === "messaging") {
      // §5 row 1 — canonical received.
      if (kind === "received") {
        return ok(RECEIVED_CONSUMERS);
      }
      // §5 row 2 — outbound send intent.
      if (kind === "send") {
        return ok(SEND_CONSUMERS);
      }
      // §5 row 3 — egress delivery confirmations.
      if (EGRESS_CONFIRMATION_KINDS.has(kind)) {
        return ok(EGRESS_CONFIRMATION_CONSUMERS);
      }
      // Other channel-service kinds have no registered durable consumer.
      return ok([]);
    }

    // §5 row 5 — registry-service lifecycle (`platform`/`system`).
    if (
      producer === "registry-service" &&
      domain === "platform" &&
      provider === "system"
    ) {
      return ok(REGISTRY_CONSUMERS);
    }

    // §5 row 6 — agent-admin-service / ai-agent-gateway automation lifecycle.
    if (
      (producer === "agent-admin-service" || producer === "ai-agent-gateway") &&
      domain === "automation" &&
      provider === "internal"
    ) {
      return ok(AGENT_AUTOMATION_CONSUMERS);
    }

    return ok([]);
  }

  // --- Non-8-token subject families ---

  // §5 row 8 — cross-tenant gateway audit stream. `GATEWAY_AUDIT_SUBJECT`
  // (constants.ts:83) is the canonical request subject; `startsWith("audit.gateway.")`
  // mirrors `GATEWAY_AUDIT_STREAM_SUBJECTS = ['audit.gateway.>']` (constants.ts:84).
  if (
    subject === GATEWAY_AUDIT_SUBJECT ||
    subject.startsWith("audit.gateway.")
  ) {
    return ok(GATEWAY_AUDIT_CONSUMERS);
  }

  // §5 row 9 — tenant provisioning request (tenant-events.ts:39-40).
  if (subject === TENANT_PROVISION_REQUESTED_SUBJECT) {
    return ok(TENANT_PROVISION_CONSUMERS);
  }

  // No known durable consumer for this subject family.
  return ok([]);
}
