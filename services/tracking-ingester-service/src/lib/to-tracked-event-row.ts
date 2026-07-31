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
//     envelope. TAXONOMY.md §4 note + DRIFT#9: `envelope.domain` can lie —
//     agent-memory envelopes published before 2026-07-31 report `automation`
//     while their subject domain token is `agent-memory` (envelope-drift T08
//     aligned the body; those rows are still in the store). The subject tokens
//     are authoritative for classification regardless, and `classify` already
//     reads the subject exclusively.
//   - Descriptive dimension columns `tenant`/`producer`/`domain` prefer the
//     envelope field (guaranteed present by `isCompliantEnvelope`), matching the
//     SPEC.md T04 rule "prefer envelope fields where the envelope carries them".
//   - `kind`/`version` are parsed from the subject: the `EventEnvelope` contract
//     (packages/shared/src/interfaces.ts) carries neither field, so the subject
//     is the only source. Null when the subject is not the canonical 8-token shape.
//   - Correlation columns (`correlation_id`/`causation_id`/`causation_depth`) are
//     copied VERBATIM from the envelope. The mapper derives NOTHING — no
//     re-derivation of the causal chain (SPEC.md code-style contract).

import type { EventEnvelope } from "@yoizen/shared";
import { isCompliantEnvelope, parseSubject } from "@yoizen/shared";
import type { BusinessFn, Tech } from "./classify.js";
import { type ClassifyOptions, classify } from "./classify.js";
import { consumedBy } from "./consumed-by.js";
import { extractDetailColumns } from "./extract-detail-columns.js";
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
/**
 * Envelope-compliance level recorded on every row (DDL column, `NOT NULL`, so
 * EVERY row-producing path MUST set it). Three coherent, ordered levels of how
 * close the stored body is to a canonical `EventEnvelope`:
 *
 *   - `"full"`    — the body IS a compliant `EventEnvelope` (passed
 *                   `isCompliantEnvelope` outright). The default canonical row.
 *   - `"partial"` — STAGE-1 INGRESS EXCEPTION (user-approved decision
 *                   "option A: canonical-with-known-drift"). The body is a
 *                   stage-1 `webhook_received` envelope (TAXONOMY.md §4 rule 2)
 *                   that is compliant in EVERY field EXCEPT the intentionally
 *                   absent (or `null`) `accountid`. The api-gateway builds this
 *                   stage-1 shape as `WebhookIngressEnvelope = Omit<EventEnvelope,
 *                   "accountid">` — the documented, currently-shipping drift in
 *                   DRIFT.md §"Discrepancies" rows 6 & 7 (`envelope-schema.json`
 *                   models no `WebhookIngressEnvelope` and unconditionally
 *                   `required`s `accountid`, contradicting the code that omits
 *                   it). Such rows are treated as canonical: classified by
 *                   subject, `correlation_id`/`tenant` preserved, real `event_id`
 *                   (`envelope.id`), never synthesized.
 *   - `"none"`    — the body is NOT an `EventEnvelope` at all: subject-only
 *                   non-envelope families (rules 1/12/13/14/15) and malformed
 *                   drift (rule 18). Set by `buildNonEnvelopeRow` (T07).
 */
export type Compliance = "full" | "partial" | "none";

/**
 * Payload lifecycle state recorded on every row (DDL column, `NOT NULL`, so
 * EVERY row-producing path MUST set it — see `tracked-events.sql` T01 header
 * for the full state machine). T01 (this mapper) only ever assigns the two
 * terminal-simple values:
 *
 *   - `"inline"` — the envelope carries a non-null `data.payload`.
 *   - `"none"`   — the envelope carries no payload at all (missing `data`,
 *                  missing `data.payload`, or an explicit `null`). This
 *                  INCLUDES today's claim-check rows (`payload_inline: false`,
 *                  `data.payload: null`) — T02 introduces the `"resolved"` /
 *                  `"unresolved"` split for those once claim-check resolution
 *                  at ingest exists; until then "no payload persisted yet" is
 *                  accurately `"none"`.
 *
 * `"resolved"` / `"unresolved"` (T02, claim-check resolution) and
 * `"scrubbed"` (T03, retention scrub) are assigned by later pipeline stages,
 * never by this mapper.
 */
export type PayloadStatus =
  | "inline"
  | "resolved"
  | "unresolved"
  | "scrubbed"
  | "none";

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
  /**
   * Envelope-compliance verdict (`"full"` | `"partial"` | `"none"`) — see the
   * `Compliance` docs. Canonical rows are `"full"`; the stage-1 `webhook_received`
   * exception is `"partial"`; non-envelope/drift rows are `"none"`.
   */
  compliance: Compliance;
  /**
   * Click-through detail columns (T4 of trace-visualization). Nullable —
   * populated ONLY for workflow-execution (rule 19) and connector-invocation
   * (rule 11) events; every other family is null. See `extract-detail-columns.ts`
   * for field-name provenance and the documented workflowId/runId gap.
   */
  workflow_id: string | null;
  run_id: string | null;
  connector_id: string | null;
  cache_status: string | null;
  /**
   * Payload lifecycle state (`Compliance`-style `NOT NULL` column) — see the
   * `PayloadStatus` docs. This mapper sets `"inline"` / `"none"`; T02/T03
   * assign the remaining states downstream of insertion.
   */
  payload_status: PayloadStatus;
  /** Set by the T03 retention scrub; always `null` at insert time. */
  payload_scrubbed_at: string | null;
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

// Synthetic value used ONLY to probe whether `accountid` is the SOLE compliance
// failure. Never stored — the original body is persisted verbatim.
const STAGE1_ACCOUNTID_PROBE = "__stage1_accountid_probe__";

/**
 * STAGE-1 INGRESS EXCEPTION detector (user-approved "canonical-with-known-drift").
 *
 * Returns a compliant `EventEnvelope` view of `envelope` when — and ONLY when —
 * the message is a genuine stage-1 `webhook_received` envelope whose ONLY
 * compliance failure is the intentionally-absent `accountid` (DRIFT.md rows 6 &
 * 7: api-gateway builds `WebhookIngressEnvelope = Omit<EventEnvelope,
 * "accountid">`). Returns `null` for anything else, so any OTHER compliance
 * failure keeps flowing to the drift path exactly as before.
 *
 * Exact-width guarantee (repo playbook: the exception is no wider than the known
 * case), enforced by TWO independent gates:
 *   1. Subject gate — the subject MUST classify as TAXONOMY.md §4 rule 2
 *      (stage-1 `webhook_received`). A non-stage-1 subject never qualifies.
 *   2. Sole-failure probe — `!isCompliantEnvelope(env) &&
 *      isCompliantEnvelope({ ...env, accountid })`. The caller already
 *      established the left conjunct (this runs on the non-compliant branch);
 *      re-adding a synthetic `accountid` and re-testing proves `accountid` was
 *      the ONLY thing missing. If ANY other field were also non-compliant, the
 *      probed copy would still fail and we return `null`. The probe covers both
 *      an absent key and an explicit `accountid: null` (both fail the
 *      `typeof === "string"` check in `isCompliantEnvelope`).
 */
function stage1PartialEnvelope(
  subject: string,
  envelope: unknown,
  options: ClassifyOptions
): EventEnvelope | null {
  // Gate 1: subject must be the stage-1 webhook_received family (rule 2).
  const subjectClass = classify(subject, options);
  if (!subjectClass.ok || subjectClass.value.rule !== 2) {
    return null;
  }
  // Gate 2: sole-failure probe. Only objects can carry an envelope shape; a
  // primitive/null body could never be "compliant except accountid".
  if (envelope === null || typeof envelope !== "object") {
    return null;
  }
  // The probe unconditionally OVERWRITES accountid, so a wrong-typed accountid
  // (e.g. a number) also qualifies as the sole failure and maps to "partial" —
  // theoretical, and the original body is still stored verbatim regardless.
  const probed = {
    ...(envelope as Record<string, unknown>),
    accountid: STAGE1_ACCOUNTID_PROBE,
  };
  // If adding ONLY a synthetic accountid makes it compliant, then accountid was
  // the sole failure — the provable "exact width" of this exception.
  return isCompliantEnvelope(probed) ? probed : null;
}

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

  // Establish the compliance verdict + the `EventEnvelope` view we project from.
  //   - `"full"`    → body is compliant outright.
  //   - `"partial"` → STAGE-1 INGRESS EXCEPTION (accountid the sole failure).
  //   - otherwise   → expected failure, routed as a `MapError` (unchanged).
  let compliance: Compliance;
  let source: EventEnvelope;
  if (isCompliantEnvelope(envelope)) {
    compliance = "full";
    source = envelope;
  } else {
    // STAGE-1 INGRESS EXCEPTION (user-approved "canonical-with-known-drift").
    // A stage-1 `webhook_received` envelope (TAXONOMY.md §4 rule 2) whose ONLY
    // compliance failure is the intentionally-absent `accountid` is treated as
    // canonical — DRIFT.md rows 6 & 7 document that api-gateway builds it as
    // `WebhookIngressEnvelope = Omit<EventEnvelope, "accountid">`. The detector
    // is width-provable (subject-rule gate + sole-failure probe); ANY other
    // compliance failure returns `null` and falls through to the drift path.
    const partial = stage1PartialEnvelope(subject, envelope, options);
    if (partial) {
      compliance = "partial";
      source = partial;
    } else {
      // SPEC.md T04: a non-compliant envelope is an expected failure, not an
      // exception. Classify the SUBJECT FIRST — rules 1/12/13/14/15 are
      // subject-only — so a well-formed non-envelope family stays routable
      // instead of being collapsed into a single generic "not compliant" string.
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

  const claimCheck = isClaimCheck(source);
  if (!claimCheck.ok) {
    return err<MapError>({
      kind: "malformed_envelope",
      reason: `is_claim_check resolution failed: ${claimCheck.error}`,
    });
  }

  const parsed = parseSubject(subject);
  const { tech, businessFn, rule } = classification.value;
  // T4 click-through columns — derived from the SAME rule the classifier
  // already computed, over `source.data.payload` (never re-classifies).
  const detailColumns = extractDetailColumns(rule, source.data?.payload);

  // T01 payload lifecycle: status-accurate at insert time, nothing more.
  // `data.payload` non-null → "inline"; absent/null (including today's
  // un-resolved claim-check rows) → "none". T02 refines the claim-check
  // subset into "resolved"/"unresolved".
  const payloadStatus: PayloadStatus =
    source.data?.payload != null ? "inline" : "none";

  return ok({
    // Canonical branch: fully-populated row. `event_id` is the REAL envelope id
    // (`source.id`), never synthesized — including the stage-1 `"partial"` case,
    // per the user-approved decision. The non-envelope branch (T07) synthesizes
    // `"<stream>:<seq>"` instead.
    event_id: source.id,
    subject,
    // Descriptive dimensions prefer the envelope (SPEC.md T04); every field is
    // guaranteed present as a string by isCompliantEnvelope (accountid excepted
    // on the stage-1 `"partial"` branch, which is not a projected column).
    tenant: source.tenant,
    producer: source.producer,
    domain: source.domain,
    // kind/version live only on the subject — EventEnvelope carries neither.
    kind: parsed?.kind ?? null,
    version: parsed?.version ?? null,
    // Correlation copied VERBATIM — the mapper derives nothing.
    correlation_id: source.correlation_id,
    causation_id: source.causation_id,
    causation_depth: source.transport?.depth ?? null,
    occurred_at: source.time,
    tech,
    business_fn: businessFn,
    rule,
    consumed_by: [...consumers.value],
    is_claim_check: claimCheck.value,
    // The ORIGINAL body is stored verbatim into the `unknown` jsonb column — on
    // the stage-1 `"partial"` branch this is the real `Omit<..., "accountid">`
    // envelope, NOT the internal accountid-probe copy used for field access.
    envelope,
    // "full" (compliant outright) or "partial" (stage-1 accountid-only drift).
    compliance,
    payload_status: payloadStatus,
    // Never set at insert time — only the T03 scrub job assigns this.
    payload_scrubbed_at: null,
    ...detailColumns,
  });
}
