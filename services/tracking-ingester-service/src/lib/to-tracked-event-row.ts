// Row mapper — projects a canonical bus-event `EventEnvelope` (plus its NATS
// delivery subject) onto a `TrackedEventRow` for `tracking.tracked_events`.
// Pure function, no side effects, Result-typed. Never throws for expected
// failures (a non-compliant envelope is an expected failure, not an exception).
//
// Composition (this file re-implements NOTHING):
//   - classification (`tech`, `business_fn`, `rule`) → `classify(subject)` (T02)
//   - `consumed_by` facet                            → `consumedBy(subject)` (T03)
//   - `is_claim_check` facet                         → `isClaimCheck(envelope)` (T03)
//   - envelope/subject shape validation              → `isCompliantEnvelope` /
//                                                       `parseSubject` (@yoizen/shared)
//
// Authority for each column (SPEC.md T04 + TAXONOMY.md §4):
//   - Classification columns are ALWAYS derived from the subject, never the
//     envelope. TAXONOMY.md §4 note + DRIFT#9: `envelope.domain` can lie (the
//     agent-memory envelope reports `automation` while the subject domain token
//     is `agent-memory`), so the subject tokens are authoritative for
//     classification. `classify` already reads the subject exclusively.
//   - Descriptive dimension columns `tenant`/`producer`/`domain` prefer the
//     envelope field (guaranteed present by `isCompliantEnvelope`), matching the
//     SPEC.md T04 rule "prefer envelope fields where the envelope carries them".
//   - `kind`/`version` are parsed from the subject: the `EventEnvelope` contract
//     (packages/shared/src/interfaces.ts) carries neither field, so the subject
//     is the only source. Null when the subject is not the canonical 8-token shape.
//   - Correlation columns (`correlation_id`/`causation_id`/`causation_depth`) are
//     copied VERBATIM from the envelope. The mapper derives NOTHING — no
//     re-derivation of the causal chain (SPEC.md code-style contract).

import { isCompliantEnvelope, parseSubject } from "@yoizen/shared";
import type { BusinessFn, Tech } from "./classify.js";
import { type ClassifyOptions, classify } from "./classify.js";
import { consumedBy } from "./consumed-by.js";
import { isClaimCheck } from "./is-claim-check.js";
import { err, ok, type Result } from "./result.js";

/**
 * One row of `tracking.tracked_events`.
 *
 * The row type deliberately admits BOTH shapes that land in the table so the
 * DDL (T05) and the `ON CONFLICT (event_id)` upsert (T06) are designed once,
 * for both branches, instead of being retrofitted:
 *
 *   1. Canonical branch (this mapper, SPEC.md T04): a compliant `EventEnvelope`.
 *      Produces a FULLY-populated row — `event_id`, `tenant`, `correlation_id`
 *      are non-null strings and `envelope` IS a compliant `EventEnvelope`.
 *
 *   2. Non-envelope branch (T07, dedicated tracked path — see `mapError` doc):
 *      classify-able non-envelope families such as the cross-tenant
 *      `audit.gateway.>` GATEWAY_AUDIT stream (TAXONOMY.md §4 rule 14;
 *      golden/labeled.tsv rows 72-73). Those rows have an EMPTY envelope
 *      `event_id`/`correlation_id`, cross-tenant scope, and a body that is NOT
 *      an `EventEnvelope`. Hence the columns below are nullable / `unknown`.
 *
 * Nullability + synthesis contract (binding on T05/T06/T07):
 *   - `event_id`: canonical rows use `envelope.id`. Non-envelope rows have no
 *     intrinsic id, so T07 MUST synthesize a stable, unique id as
 *     `"<stream>:<seq>"` (JetStream stream name + sequence, e.g.
 *     `"GATEWAY_AUDIT:41771"` — mirrors the golden fixture naming
 *     `GATEWAY_AUDIT-seq41771.json`). T05 makes `event_id` the primary key and
 *     T06 conflicts on it, so the synthesis scheme MUST match across all three.
 *   - `tenant`: `string | null` — null for cross-tenant families (audit.gateway
 *     is not scoped to a single tenant).
 *   - `correlation_id` / `causation_id`: `string | null` — non-canonical rows
 *     carry no causal chain; the mapper still copies canonical values VERBATIM.
 *   - `envelope`: `jsonb` column typed as the raw payload (`unknown`). On the
 *     canonical branch it is guaranteed to be a compliant `EventEnvelope`; on
 *     the non-envelope branch it is the raw family body (e.g. GatewayAuditEvent).
 *
 * `ingested_at` is a DB-side default (`now()`), so it is intentionally NOT part
 * of the mapper output.
 */
export interface TrackedEventRow {
  event_id: string;
  subject: string;
  tenant: string | null;
  producer: string;
  domain: string;
  /** From the subject `<kind>` token; null when the subject is non-canonical. */
  kind: string | null;
  /** From the subject `<version>` token; null when the subject is non-canonical. */
  version: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  causation_depth: number | null;
  occurred_at: string;
  tech: Tech;
  business_fn: BusinessFn;
  /** TAXONOMY.md §4 rule number (1-18) that fired. */
  rule: number;
  consumed_by: string[];
  is_claim_check: boolean;
  /**
   * Raw `jsonb` payload. Guaranteed to be a compliant `EventEnvelope` on the
   * canonical branch this mapper produces; `unknown` so T07's non-envelope
   * branch can store a raw family body without a type cast.
   */
  envelope: unknown;
}

/**
 * Structured, tagged rejection reason. This is a DISCRIMINANT, never a prose
 * string, so T07 can route on `error.kind` instead of substring-matching a
 * message. Classification runs on the SUBJECT (rules 1/12/13/14/15 are
 * subject-only) BEFORE the envelope compliance verdict, so a well-formed
 * non-envelope family is distinguished from genuine envelope drift.
 */
export type MapError =
  /** Subject failed the minimal non-empty guard — nothing is routable. */
  | { kind: "invalid_subject"; reason: string }
  /**
   * A well-formed, classify-able NON-envelope family: the subject matched a
   * subject-only rule (1 DLQ, 12 runtime-stream, 13 tenant-lifecycle,
   * 14 gateway-audit, 15 legacy) but the body is not a canonical
   * `EventEnvelope`. This is NOT drift and MUST NOT alarm.
   *
   * T07 MUST route `audit.gateway.>` (and every other family surfaced here)
   * through the dedicated TRACKED non-envelope path — those events ARE tracked,
   * not dropped: TAXONOMY.md §4 rule 14 assigns them `tech: gateway-audit`,
   * `business_fn: audit`, and golden/labeled.tsv rows 72-73 label two live
   * GATEWAY_AUDIT events ALTA. `rule`/`tech`/`business_fn` are carried here so
   * T07 builds the tracked row without re-classifying.
   */
  | {
      kind: "non_envelope_family";
      rule: number;
      tech: Tech;
      business_fn: BusinessFn;
    }
  /**
   * The body claims to be a canonical envelope (or arrives on a canonical
   * `evt.` family) but fails `isCompliantEnvelope` — genuine drift the
   * consumer SHOULD alarm on.
   */
  | { kind: "malformed_envelope"; reason: string };

// Subject-only families (TAXONOMY.md §4 rules 1/12/13/14/15) legitimately carry
// NON-envelope bodies. When one of these classifies a non-compliant message the
// rejection is routable (`non_envelope_family`), not drift. Canonical `evt.`
// families (rules 2-11) with a broken body ARE drift → `malformed_envelope`.
const SUBJECT_ONLY_NON_ENVELOPE_RULES = new Set([1, 12, 13, 14, 15]);

/**
 * Maps `(subject, envelope)` onto a `TrackedEventRow`.
 *
 * The subject is passed in alongside the envelope because it is the NATS
 * delivery subject (the authoritative routing key) and non-canonical producers
 * may not echo it inside the envelope body.
 *
 * This mapper ONLY maps compliant `EventEnvelope`s (that IS SPEC.md T04). It
 * returns the error branch (never throws) with a routable `MapError` when:
 *   - the subject is missing/empty (`invalid_subject`),
 *   - the body is a classify-able non-envelope family that T07's dedicated
 *     tracked path must handle (`non_envelope_family`), or
 *   - the body is canonical-family drift (`malformed_envelope`).
 */
export function toTrackedEventRow(
  subject: string,
  envelope: unknown,
  options: ClassifyOptions = {}
): Result<TrackedEventRow, MapError> {
  if (typeof subject !== "string" || subject.length === 0) {
    return err<MapError>({
      kind: "invalid_subject",
      reason: "subject must be a non-empty string",
    });
  }

  // SPEC.md T04: a non-compliant envelope is an expected failure, not an
  // exception. Classify the SUBJECT FIRST — rules 1/12/13/14/15 are subject-only
  // — so a well-formed non-envelope family stays routable instead of being
  // collapsed into a single generic "not compliant" string.
  if (!isCompliantEnvelope(envelope)) {
    const subjectClass = classify(subject, options);
    if (
      subjectClass.ok &&
      SUBJECT_ONLY_NON_ENVELOPE_RULES.has(subjectClass.value.rule)
    ) {
      // Routable: e.g. audit.gateway.request → rule 14 (TAXONOMY.md §4).
      return err<MapError>({
        kind: "non_envelope_family",
        rule: subjectClass.value.rule,
        tech: subjectClass.value.tech,
        business_fn: subjectClass.value.businessFn,
      });
    }
    // Canonical `evt.` family (or unclassifiable) with a broken body → drift.
    return err<MapError>({
      kind: "malformed_envelope",
      reason:
        "envelope is not a compliant EventEnvelope (fails isCompliantEnvelope)",
    });
  }

  // Classification is derived exclusively from the subject (TAXONOMY.md §4 +
  // DRIFT#9). `streamName` is forwarded so a DLQ-stream delivery short-circuits
  // to rule 1 even when the subject alone does not reveal it.
  const classification = classify(subject, options);
  if (!classification.ok) {
    return err<MapError>({
      kind: "malformed_envelope",
      reason: `classification failed: ${classification.error}`,
    });
  }

  const consumers = consumedBy(subject);
  if (!consumers.ok) {
    return err<MapError>({
      kind: "malformed_envelope",
      reason: `consumed_by resolution failed: ${consumers.error}`,
    });
  }

  const claimCheck = isClaimCheck(envelope);
  if (!claimCheck.ok) {
    return err<MapError>({
      kind: "malformed_envelope",
      reason: `is_claim_check resolution failed: ${claimCheck.error}`,
    });
  }

  const parsed = parseSubject(subject);
  const { tech, businessFn, rule } = classification.value;

  return ok({
    // Canonical branch: fully-populated row. `event_id` is the envelope id;
    // the non-envelope branch (T07) synthesizes `"<stream>:<seq>"` instead.
    event_id: envelope.id,
    subject,
    // Descriptive dimensions prefer the envelope (SPEC.md T04); every field is
    // guaranteed present as a string by isCompliantEnvelope.
    tenant: envelope.tenant,
    producer: envelope.producer,
    domain: envelope.domain,
    // kind/version live only on the subject — EventEnvelope carries neither.
    kind: parsed?.kind ?? null,
    version: parsed?.version ?? null,
    // Correlation copied VERBATIM — the mapper derives nothing.
    correlation_id: envelope.correlation_id,
    causation_id: envelope.causation_id,
    causation_depth: envelope.transport?.depth ?? null,
    occurred_at: envelope.time,
    tech,
    business_fn: businessFn,
    rule,
    consumed_by: [...consumers.value],
    is_claim_check: claimCheck.value,
    // Guaranteed to be a compliant EventEnvelope on this branch (narrowed by
    // isCompliantEnvelope above); stored verbatim into the `unknown` jsonb column.
    envelope,
  });
}
