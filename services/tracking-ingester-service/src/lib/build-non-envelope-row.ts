// Builds a `TrackedEventRow` for messages that are NOT canonical
// `EventEnvelope`s but MUST still be tracked (never dropped). Two callers in
// the T07 pipeline use it:
//
//   1. `non_envelope_family` (TAXONOMY.md §4 rules 1/12/13/14/15 — dlq, rt.*,
//      tenant-lifecycle, audit.gateway, legacy): a well-formed non-envelope
//      family. `toTrackedEventRow` already classified the SUBJECT and handed us
//      `tech`/`business_fn`/`rule`; this is NOT drift and NOT an alarm.
//   2. `malformed_envelope` drift: a canonical family (or undecodable body) that
//      failed `isCompliantEnvelope`. The T07 decision (see consume-events.ts) is
//      to PERSIST it as rule 18 `unknown` so the dashboard's `unknown = alarm`
//      signal surfaces it (TAXONOMY.md §3 decision note: "any non-zero unknown
//      count is actionable").
//
// Pure function, no side effects, never throws. The synthesized `event_id`
// contract is BINDING (to-tracked-event-row.ts doc, T05 PK, T06 upsert):
// `"<stream>:<seq>"` — the JetStream stream name plus its stream sequence
// (mirrors the golden fixture naming `GATEWAY_AUDIT-seq41771.json`).

import { parseSubject } from "@yoizen/shared";
import type { BusinessFn, Tech } from "./classify.js";
import { consumedBy } from "./consumed-by.js";
import type { TrackedEventRow } from "./to-tracked-event-row.js";

export interface NonEnvelopeRowInput {
  /** NATS delivery subject (authoritative routing key). */
  readonly subject: string;
  /** JetStream stream name — first half of the synthesized `event_id`. */
  readonly streamName: string;
  /** JetStream stream sequence — second half of the synthesized `event_id`. */
  readonly streamSequence: number;
  /** Raw decoded body (or raw text when the body was not JSON). Stored verbatim. */
  readonly payload: unknown;
  /** Ingest wall-clock (ISO) used for `occurred_at` — these bodies carry no
   *  guaranteed canonical `time` field. Injected at the I/O edge so the builder
   *  stays pure. */
  readonly receivedAt: string;
  readonly tech: Tech;
  readonly businessFn: BusinessFn;
  /** TAXONOMY.md §4 rule number that fired (1/12/13/14/15 for families, 18 for drift). */
  readonly rule: number;
}

/**
 * Projects a non-envelope (or malformed) message onto a `TrackedEventRow`.
 *
 * `producer`/`domain` are `NOT NULL` in the DDL (T05) yet non-envelope bodies
 * carry no canonical envelope fields, so they are derived deterministically:
 *   - a canonical 8-token subject → `parseSubject` producer/domain/tenant;
 *   - otherwise → the leading subject tokens (`audit.gateway.request` →
 *     domain `audit`, producer `gateway`), falling back to the stream name.
 * This is a synthesized descriptive dimension, honest and traceable, never a
 * classification input (classification came from the subject, TAXONOMY.md §4).
 */
export function buildNonEnvelopeRow(
  input: NonEnvelopeRowInput
): TrackedEventRow {
  const parsed = parseSubject(input.subject);
  const tokens = input.subject.split(".");
  const consumers = consumedBy(input.subject);

  const row: TrackedEventRow = {
    // Synthesized stable id — BINDING scheme shared with T05 PK / T06 upsert.
    event_id: `${input.streamName}:${input.streamSequence}`,
    subject: input.subject,
    // Canonical-shaped subjects keep their tenant token; cross-tenant/unknown
    // families (audit.gateway, rt.*, legacy) are null tenant per the T04 contract.
    tenant: parsed?.tenant ?? null,
    // NOT NULL columns — derived, never null (subject is always non-empty here).
    producer: parsed?.producer ?? tokens[1] ?? tokens[0] ?? input.streamName,
    domain: parsed?.domain ?? tokens[0] ?? input.streamName,
    kind: parsed?.kind ?? null,
    version: parsed?.version ?? null,
    // Non-canonical bodies carry no causal chain — the mapper derives nothing.
    correlation_id: null,
    causation_id: null,
    causation_depth: null,
    occurred_at: input.receivedAt,
    tech: input.tech,
    business_fn: input.businessFn,
    rule: input.rule,
    consumed_by: consumers.ok ? [...consumers.value] : [],
    // A non-compliant body is not a claim-check envelope by construction.
    is_claim_check: false,
    envelope: input.payload,
    // Neither a full nor a stage-1-partial EventEnvelope — the body is not an
    // envelope at all (subject-only family or drift). See `Compliance` docs.
    compliance: "none",
    // T4 click-through columns are canonical-envelope-only (workflow-execution
    // rule 19 / connector-invocation rule 11 both require a parsed `EventEnvelope`
    // body to read `data.payload` from) — non-envelope rows never populate them.
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
  };

  return row;
}
