import type { ChannelEnvelope } from "@yoizen/shared";

/**
 * Normalized row parsed from a channel envelope. The Mongo time-series
 * document is built in {@link insertBatch} with a `meta` subdocument.
 */
export interface IChannelEventRow {
  readonly ts: Date;
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly channel: string;
  readonly direction: "ingress" | "egress" | "dlq";
  readonly subject: string;
  readonly messageType: string | null;
}

/**
 * Outcome of {@link parseEnvelope}. Either a well-formed row or a
 * structured rejection the caller can surface as a metric without
 * allocating an Error stack trace on every bad message.
 */
export type ParseOutcome =
  | { readonly ok: true; readonly row: IChannelEventRow }
  | { readonly ok: false; readonly reason: string };

/**
 * Maps a `ChannelEnvelope.kind` to the direction column. `null`
 * means "ignore this event" (e.g. `send` is an intent, not a
 * movement of bytes on the wire, so it would double-count egress).
 */
const KIND_TO_DIRECTION = new Map<string, "ingress" | "egress" | null>([
  ["received", "ingress"],
  ["webhook_received", "ingress"],
  ["sent", "egress"],
  ["delivered", "egress"],
  ["read", "egress"],
  ["failed", "egress"],
  ["send", null],
]);

/**
 * INGRESS-`<tenant>` streams bind `evt.<tenant>.>` — the tenant-wide
 * firehose — which delivers workflow, registry, audit, etc. events
 * alongside channel messaging events. This marker identifies the
 * *only* subject family the aggregator tracks, so we can cheaply
 * drop everything else **before** paying for a JSON decode.
 *
 * Format: `evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v<version>`
 * (see `packages/shared/src/channel.constants.ts`).
 */
const CHANNEL_SUBJECT_MARKER = ".channel-service.messaging.";

/**
 * Canonical `producer` token for channel-service envelopes
 * (see `CHANNEL_PRODUCER` in `@yoizen/shared`). Re-declared locally to
 * keep this parser self-contained on the hot path. Kept in lock-step
 * with the constant — if the producer token ever changes, both places
 * must be updated together.
 *
 * Used as a second line of defense so that *even if* a malformed
 * envelope lands on a channel-service subject (e.g. a future bug, or
 * a misrouted subject), we only aggregate envelopes whose producer
 * explicitly claims to be `channel-service`. This guarantees that
 * pre-account-resolution envelopes produced by `api-gateway`
 * (`producer = "api-gateway"`, no `accountid`) can never poison the
 * usage rows.
 */
const EXPECTED_CHANNEL_PRODUCER = "channel-service";

/**
 * Parses a raw NATS message body into an `IChannelEventRow`.
 *
 * @param data        Raw `msg.data` Uint8Array.
 * @param subject     `msg.subject` (persisted alongside for auditing).
 * @param streamName  Bound stream ("INGRESS-xyz" | "DLQ-xyz"). DLQ
 *                    forces `direction=dlq` regardless of kind.
 *
 * Fast-path: single `TextDecoder` allocation + `JSON.parse`.
 * Complexity: O(n) on payload length.
 */
export function parseEnvelope(
  data: Uint8Array,
  subject: string,
  streamName: string,
): ParseOutcome {
  // Cheap subject pre-filter: INGRESS-<tenant> carries the full
  // tenant firehose, so reject non-channel subjects before the JSON
  // decode. DLQ streams are populated only by channel failures, so
  // they skip this gate. `String.includes` is O(n) on the subject
  // (single-digit tens of chars), ~100x cheaper than a JSON.parse.
  if (
    streamName.startsWith("INGRESS-") &&
    !subject.includes(CHANNEL_SUBJECT_MARKER)
  ) {
    return { ok: false, reason: "non-channel-subject" };
  }

  let envelope: Partial<ChannelEnvelope> & Record<string, unknown>;
  try {
    envelope = JSON.parse(new TextDecoder().decode(data)) as Partial<
      ChannelEnvelope
    > &
      Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      reason: `json-parse:${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // Defense in depth: only aggregate envelopes whose producer claims
  // `channel-service`. DLQ streams carry failed channel-service
  // envelopes by construction, so the check is only enforced on the
  // tenant-wide INGRESS firehose.
  if (
    streamName.startsWith("INGRESS-") &&
    envelope.producer !== EXPECTED_CHANNEL_PRODUCER
  ) {
    return { ok: false, reason: "non-channel-producer" };
  }

  const idempotencyKey =
    typeof envelope.idempotencykey === "string"
      ? envelope.idempotencykey
      : null;
  if (!idempotencyKey) {
    return { ok: false, reason: "missing-idempotencykey" };
  }

  const accountId =
    typeof envelope.accountid === "string" ? envelope.accountid : null;
  if (!accountId) {
    return { ok: false, reason: "missing-accountid" };
  }

  const channel =
    typeof envelope.channel === "string" ? envelope.channel : null;
  if (!channel) {
    return { ok: false, reason: "missing-channel" };
  }

  const timeRaw = typeof envelope.time === "string" ? envelope.time : null;
  const ts = timeRaw ? new Date(timeRaw) : new Date();
  if (Number.isNaN(ts.getTime())) {
    return { ok: false, reason: "invalid-time" };
  }

  const direction = resolveDirection(envelope.kind, streamName);
  if (direction === null) {
    return { ok: false, reason: "unknown-kind" };
  }
  if (direction === "skip") {
    return { ok: false, reason: "skipped-kind" };
  }

  const messageType = extractMessageType(envelope);

  return {
    ok: true,
    row: {
      ts,
      idempotencyKey,
      accountId,
      channel,
      direction,
      subject,
      messageType,
    },
  };
}

/**
 * DLQ streams are authoritative: a message lands there only because
 * the platform gave up on it, so `direction=dlq` wins over whatever
 * kind the envelope carried. For ingress streams we trust the kind
 * map (`received`/`webhook_received` → ingress, `sent`/`delivered`
 * → egress).
 */
function resolveDirection(
  kind: unknown,
  streamName: string,
): "ingress" | "egress" | "dlq" | "skip" | null {
  if (streamName.startsWith("DLQ-")) {
    return "dlq";
  }
  if (typeof kind !== "string") return null;
  const mapped = KIND_TO_DIRECTION.get(kind);
  if (mapped === undefined) return null;
  if (mapped === null) return "skip";
  return mapped;
}

/**
 * Best-effort `message_type` extraction from the envelope payload.
 * Falls back to `null` when the payload does not carry a concrete
 * message type (e.g. pure status events like `delivered`).
 */
function extractMessageType(
  envelope: Partial<ChannelEnvelope> & Record<string, unknown>,
): string | null {
  const data = envelope.data as { payload?: { type?: unknown } } | undefined;
  const type = data?.payload?.type;
  if (typeof type === "string" && type.length > 0) return type;
  return null;
}
