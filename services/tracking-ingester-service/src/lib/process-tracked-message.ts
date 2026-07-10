// Pure per-message pipeline stage for the tracking ingester (T07).
//
// Input:  a decoded NATS/JetStream delivery (subject + stream metadata + body).
// Output: exactly one `TrackedEventRow` to persist, tagged with a
//         `ProcessOutcome` the I/O edge (consume-events.ts) routes on for
//         logging / metrics / ack-vs-term. EVERY message produces a row —
//         nothing is dropped (BINDING contract from to-tracked-event-row.ts).
//
// This stage re-implements NOTHING: classification + compliance verdict come
// from `toTrackedEventRow` (T04), non-canonical rows from `buildNonEnvelopeRow`.
// No side effects, never throws.

import { buildNonEnvelopeRow } from "./build-non-envelope-row.js";
import { type ClassifyOptions, UNKNOWN_RULES } from "./classify.js";
import {
  type MapError,
  type TrackedEventRow,
  toTrackedEventRow,
} from "./to-tracked-event-row.js";

/**
 * How the message was classified, driving the edge's observability + ack policy:
 *   - `canonical`     — compliant envelope, known rule (2-15). ack.
 *   - `non_envelope`  — well-formed non-envelope family (rules 1/12/13/14/15).
 *                       Tracked, NOT an alarm. ack.
 *   - `unknown`       — compliant envelope, unrecognized shape (rules 16/17/18).
 *                       ALARM (`unknown = alarm`, TAXONOMY.md §3). Row persisted.
 *   - `malformed`     — drift: body failed `isCompliantEnvelope` (or was not
 *                       JSON). ALARM + persisted as rule 18 unknown, then term.
 */
export type ProcessOutcome =
  | "canonical"
  | "non_envelope"
  | "unknown"
  | "malformed";

export interface RawTrackedMessage {
  readonly subject: string;
  readonly streamName: string;
  readonly streamSequence: number;
  /** JSON-decoded body, or the raw text when `decoded === false`. */
  readonly payload: unknown;
  /** `false` when the body was not valid JSON — treated as drift. */
  readonly decoded: boolean;
  /** Ingest wall-clock (ISO) — `occurred_at` for non-envelope/malformed rows. */
  readonly receivedAt: string;
}

export interface ProcessResult {
  readonly row: TrackedEventRow;
  readonly outcome: ProcessOutcome;
}

/**
 * Maps a raw delivery to `{ row, outcome }`. Classification runs on the subject
 * (via T04), so a well-formed non-envelope family is distinguished from genuine
 * envelope drift before any row is synthesized.
 */
export function processTrackedMessage(
  msg: RawTrackedMessage,
  options: ClassifyOptions = {}
): ProcessResult {
  // Undecodable body — cannot be a compliant envelope, so it is drift.
  if (!msg.decoded) {
    return {
      outcome: "malformed",
      row: buildDriftRow(msg),
    };
  }

  const mapped = toTrackedEventRow(msg.subject, msg.payload, options);
  if (mapped.ok) {
    // Only rules 16/17/18 mark unrecognized traffic — the alarm (TAXONOMY.md §3).
    // Membership in `UNKNOWN_RULES` is the SINGLE SOURCE OF TRUTH shared with
    // classify.ts; a `rule >= 16` test would wrongly flag rule 19 (workflow-
    // service, a recognized canonical family) as unknown.
    const outcome: ProcessOutcome = UNKNOWN_RULES.has(mapped.value.rule)
      ? "unknown"
      : "canonical";
    return { outcome, row: mapped.value };
  }

  return routeError(msg, mapped.error);
}

function routeError(msg: RawTrackedMessage, error: MapError): ProcessResult {
  if (error.kind === "non_envelope_family") {
    // Well-formed non-envelope family (rules 1/12/13/14/15) — tracked, not drift.
    return {
      outcome: "non_envelope",
      row: buildNonEnvelopeRow({
        subject: msg.subject,
        streamName: msg.streamName,
        streamSequence: msg.streamSequence,
        payload: msg.payload,
        receivedAt: msg.receivedAt,
        tech: error.tech,
        businessFn: error.business_fn,
        rule: error.rule,
      }),
    };
  }

  // `malformed_envelope` or `invalid_subject` → drift, persisted as unknown.
  return {
    outcome: "malformed",
    row: buildDriftRow(msg),
  };
}

/**
 * Drift row: persisted as rule 18 `unknown`/`unknown` so the dashboard's
 * `unknown = alarm` panel surfaces it instead of silently dropping the message
 * (TAXONOMY.md §3 decision note — "any non-zero unknown count is actionable").
 */
function buildDriftRow(msg: RawTrackedMessage): TrackedEventRow {
  return buildNonEnvelopeRow({
    subject: msg.subject,
    streamName: msg.streamName,
    streamSequence: msg.streamSequence,
    payload: msg.payload,
    receivedAt: msg.receivedAt,
    // Rule 18 — deterministic fallback (TAXONOMY.md §4). unknown = the alarm.
    tech: "unknown",
    businessFn: "unknown",
    rule: 18,
  });
}
