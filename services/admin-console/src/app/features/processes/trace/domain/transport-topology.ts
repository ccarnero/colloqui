import type { ITraceSubscriber } from "./message-trace.model";

/**
 * Static pub/sub registry: which durable consumers subscribe to each event
 * subject family. Deterministic from the codebase (the durables are wired in
 * the services), so this is accurate and free — live health is layered on in
 * Slice 2. See `.sdd/changes/processes-message-trace/adr.md` ADR-4.
 *
 * Subject taxonomy (8 tokens):
 *   evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>
 * We match on the trailing `<kind>.v<n>`.
 */

const RECEIVED_SUBSCRIBERS: readonly ITraceSubscriber[] = [
  { service: "workflow-service", durable: "workflow-triggers", role: "producer" },
  { service: "audit-service", durable: "channel-events-audit", role: "sink" },
];

const SEND_SUBSCRIBERS: readonly ITraceSubscriber[] = [
  { service: "channel-service", durable: "channel-egress", role: "producer" },
  { service: "audit-service", durable: "channel-events-audit", role: "sink" },
];

// `sent.v1` is the egress delivery confirmation — terminal. `channel-egress`
// consumes `send`, NOT `sent`; the only subscriber is the audit sink.
const SENT_SUBSCRIBERS: readonly ITraceSubscriber[] = [
  { service: "audit-service", durable: "channel-events-audit", role: "sink" },
];

/** Returns the known subscribers for an event subject, or `[]` if unknown. */
export function subscribersFor(subject: string): readonly ITraceSubscriber[] {
  if (!subject) return [];
  const kind = subjectKind(subject);
  if (kind === "received") return RECEIVED_SUBSCRIBERS;
  if (kind === "send") return SEND_SUBSCRIBERS;
  if (kind === "sent") return SENT_SUBSCRIBERS;
  return [];
}

/** Extracts the `<kind>` token (second-to-last) from a canonical subject. */
function subjectKind(subject: string): string {
  const tokens = subject.split(".");
  if (tokens.length < 2) return subject;
  const last = tokens[tokens.length - 1];
  // Trailing token is the version (`v1`); the kind sits just before it.
  if (/^v\d+$/.test(last)) return tokens[tokens.length - 2];
  return last;
}
