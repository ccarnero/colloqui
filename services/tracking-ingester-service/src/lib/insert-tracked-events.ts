// Batch-inserts a homogeneous set of {@link TrackedEventRow} into
// `tracking.tracked_events` with a single `UNNEST`-driven
// `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
//
// Same shape as services/usage-aggregator-service/src/modules/aggregator/
// batch-inserter.postgres.ts: array-parallel columns, one pass over the input,
// a single round trip, `ON CONFLICT` for idempotency.
//
// Idempotency / exactly-once (SPEC.md T06 + code-style contract):
//   `ON CONFLICT (event_id) DO NOTHING` drops redeliveries. Combined with the
//   `Nats-Msg-Id` header set on publish upstream, the pipeline is
//   once-and-only-once at the storage boundary. This module derives NOTHING —
//   it is pure storage; correlation lives in the mapper (T04).
//
// Pure-ish: the only side effect is the injected client. The function never
// throws for an expected failure — a failing insert is returned as an `err`.
//
// Column layout is BINDING on `TrackedEventRow` (src/lib/to-tracked-event-row.ts)
// and the DDL (src/sql/tracked-events.sql). Seventeen columns are inserted;
// `ingested_at` is a DB-side `DEFAULT now()` and is intentionally omitted.
//
// UNNEST cast notes (the two non-scalar columns are the interesting ones):
//   - `envelope` (jsonb): each row's envelope is JSON-serialized to a string and
//     the whole array is cast `::jsonb[]`, so PostgreSQL parses each element back
//     into jsonb. Passing raw JS objects through `sql.array` would not round-trip
//     to jsonb.
//   - `consumed_by` (text[] per row): a per-row array cannot pass through UNNEST
//     directly (UNNEST flattens nested arrays). Each row's list is encoded as a
//     PostgreSQL array literal string (e.g. `{"a","b"}`), passed as a scalar
//     `::text[]` UNNEST column, then cast back to `text[]` in the projection.
//   - Nullable columns (tenant, kind, version, correlation_id, causation_id,
//     causation_depth) carry JS `null` elements, which `sql.array` emits as SQL
//     NULL — no special handling required.

import { err, ok, type Result } from "./result.js";
import type { TrackedEventRow } from "./to-tracked-event-row.js";

/**
 * The minimal postgres.js surface this module needs: the tagged-template query
 * function plus its `.array` helper. Typed structurally (like T05's
 * `SchemaClient`) so the logic stays decoupled from the concrete `Sql` type and
 * is trivially testable with a fake. The real postgres.js `Sql` instance
 * satisfies this shape.
 */
export interface InsertClient {
  (
    template: TemplateStringsArray,
    ...values: readonly unknown[]
  ): PromiseLike<{ count?: number }>;
  array(values: readonly unknown[], type?: number): unknown;
}

/** How many rows the server actually inserted (duplicates skipped). */
export interface InsertOk {
  inserted: number;
}

/** Structured failure — the insert round trip raised. */
export interface InsertError {
  reason: string;
}

/**
 * Encodes a `string[]` as a PostgreSQL array literal (`{"a","b"}`), escaping
 * backslash and double-quote per the array-literal grammar. An empty list is
 * the empty-array literal `{}`.
 */
export function toPgTextArrayLiteral(values: readonly string[]): string {
  if (values.length === 0) {
    return "{}";
  }
  const escaped = values.map(
    (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  );
  return `{${escaped.join(",")}}`;
}

/**
 * Inserts `rows` into `tracking.tracked_events` in a single statement.
 *
 * @param client postgres.js client (or any `InsertClient` shape)
 * @param rows homogeneous batch of mapped rows (T04 output)
 * @param log optional line logger for verbose progress (defaults to no-op)
 * @returns the count the server inserted (excludes `ON CONFLICT` skips)
 */
export async function insertTrackedEvents(
  client: InsertClient,
  rows: readonly TrackedEventRow[],
  log: (message: string) => void = () => {}
): Promise<Result<InsertOk, InsertError>> {
  if (rows.length === 0) {
    // Empty batch short-circuit — never touch the client.
    log("insertTrackedEvents: empty batch, nothing to insert");
    return ok({ inserted: 0 });
  }

  const n = rows.length;
  const eventId = new Array<string>(n);
  const subject = new Array<string>(n);
  const tenant = new Array<string | null>(n);
  const producer = new Array<string>(n);
  const domain = new Array<string>(n);
  const kind = new Array<string | null>(n);
  const version = new Array<string | null>(n);
  const correlationId = new Array<string | null>(n);
  const causationId = new Array<string | null>(n);
  const causationDepth = new Array<number | null>(n);
  const occurredAt = new Array<string>(n);
  const tech = new Array<string>(n);
  const businessFn = new Array<string>(n);
  const rule = new Array<number>(n);
  const consumedBy = new Array<string>(n);
  const isClaimCheck = new Array<boolean>(n);
  const envelope = new Array<string>(n);

  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    eventId[i] = row.event_id;
    subject[i] = row.subject;
    tenant[i] = row.tenant;
    producer[i] = row.producer;
    domain[i] = row.domain;
    kind[i] = row.kind;
    version[i] = row.version;
    correlationId[i] = row.correlation_id;
    causationId[i] = row.causation_id;
    causationDepth[i] = row.causation_depth;
    occurredAt[i] = row.occurred_at;
    tech[i] = row.tech;
    businessFn[i] = row.business_fn;
    rule[i] = row.rule;
    // Per-row text[] encoded as a PG array literal scalar (see header note).
    consumedBy[i] = toPgTextArrayLiteral(row.consumed_by);
    isClaimCheck[i] = row.is_claim_check;
    // jsonb round-trips only via a JSON string cast to jsonb (see header note).
    envelope[i] = JSON.stringify(row.envelope);
  }

  log(`insertTrackedEvents: inserting ${n} row(s) via UNNEST`);

  try {
    const result = await client`
      INSERT INTO tracking.tracked_events (
        event_id,
        subject,
        tenant,
        producer,
        domain,
        kind,
        version,
        correlation_id,
        causation_id,
        causation_depth,
        occurred_at,
        tech,
        business_fn,
        rule,
        consumed_by,
        is_claim_check,
        envelope
      )
      SELECT
        event_id,
        subject,
        tenant,
        producer,
        domain,
        kind,
        version,
        correlation_id,
        causation_id,
        causation_depth,
        occurred_at,
        tech,
        business_fn,
        rule,
        consumed_by::text[],
        is_claim_check,
        envelope
      FROM UNNEST(
        ${client.array(eventId)}::text[],
        ${client.array(subject)}::text[],
        ${client.array(tenant)}::text[],
        ${client.array(producer)}::text[],
        ${client.array(domain)}::text[],
        ${client.array(kind)}::text[],
        ${client.array(version)}::text[],
        ${client.array(correlationId)}::text[],
        ${client.array(causationId)}::text[],
        ${client.array(causationDepth)}::integer[],
        ${client.array(occurredAt)}::timestamptz[],
        ${client.array(tech)}::text[],
        ${client.array(businessFn)}::text[],
        ${client.array(rule)}::integer[],
        ${client.array(consumedBy)}::text[],
        ${client.array(isClaimCheck)}::boolean[],
        ${client.array(envelope)}::jsonb[]
      ) AS t(
        event_id,
        subject,
        tenant,
        producer,
        domain,
        kind,
        version,
        correlation_id,
        causation_id,
        causation_depth,
        occurred_at,
        tech,
        business_fn,
        rule,
        consumed_by,
        is_claim_check,
        envelope
      )
      ON CONFLICT (event_id) DO NOTHING
    `;

    const inserted = typeof result.count === "number" ? result.count : n;
    log(`insertTrackedEvents: server inserted ${inserted} row(s)`);
    return ok({ inserted });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`insertTrackedEvents: FAILED — ${reason}`);
    return err<InsertError>({ reason });
  }
}
