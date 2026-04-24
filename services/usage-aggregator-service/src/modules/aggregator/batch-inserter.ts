import type { Sql } from "@yoizen/database";
import type { IChannelEventRow } from "./envelope-parser";

/**
 * Upserts a homogeneous batch of {@link IChannelEventRow} into the
 * `channel_events` hypertable using a single `UNNEST`-driven
 * `INSERT ... ON CONFLICT (idempotency_key, ts) DO NOTHING`.
 *
 * Design notes:
 *  - Array-parallel layout matches the column order of the SQL —
 *    one pass over the input, zero hidden O(n) lookups.
 *  - Exactly-once semantics: `ON CONFLICT` drops duplicates left by
 *    redeliveries / aggregator crashes. Combined with the Nats-Msg-Id
 *    header on publish, the pipeline is effectively once-and-only-once
 *    at the billing boundary.
 *  - Single round trip per batch → amortized O(1) DB calls per row.
 *
 * @returns the row count inserted by the server (not counting
 *          duplicates skipped by `ON CONFLICT`).
 */
export async function insertBatch(
  sql: Sql,
  rows: readonly IChannelEventRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const ts = new Array<Date>(rows.length);
  const idem = new Array<string>(rows.length);
  const accountId = new Array<string>(rows.length);
  const channel = new Array<string>(rows.length);
  const direction = new Array<string>(rows.length);
  const subject = new Array<string>(rows.length);
  const messageType = new Array<string | null>(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    ts[i] = r.ts;
    idem[i] = r.idempotencyKey;
    accountId[i] = r.accountId;
    channel[i] = r.channel;
    direction[i] = r.direction;
    subject[i] = r.subject;
    messageType[i] = r.messageType;
  }

  const result = await sql`
    INSERT INTO channel_events (
      ts,
      idempotency_key,
      account_id,
      channel,
      direction,
      subject,
      message_type
    )
    SELECT * FROM UNNEST(
      ${sql.array(ts)}::timestamptz[],
      ${sql.array(idem)}::text[],
      ${sql.array(accountId)}::text[],
      ${sql.array(channel)}::text[],
      ${sql.array(direction)}::text[],
      ${sql.array(subject)}::text[],
      ${sql.array(messageType)}::text[]
    )
    ON CONFLICT (idempotency_key, ts) DO NOTHING
  `;

  return typeof result.count === "number" ? result.count : rows.length;
}
