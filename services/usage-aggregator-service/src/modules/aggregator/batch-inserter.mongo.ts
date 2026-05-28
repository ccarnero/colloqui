import type { Db } from "mongodb";
import { isMongoDuplicateKeyError } from "@yoizen/database";
import type { IChannelEventRow } from "./envelope-parser";

interface IChannelEventDoc {
  readonly ts: Date;
  readonly idempotency_key: string;
  readonly meta: {
    readonly tenant_id?: string;
    readonly channel_id: string;
    readonly account_id: string;
  };
  readonly direction: "ingress" | "egress" | "dlq";
  readonly subject: string;
  readonly message_type: string | null;
}

/**
 * Inserts a homogeneous batch into the `channel_events` time-series
 * collection. Uses `insertMany({ ordered: false })` so duplicate-key
 * collisions from redeliveries are ignored without failing the batch.
 *
 * @returns the number of rows inserted (duplicates excluded).
 */
export async function insertBatch(
  db: Db,
  rows: readonly IChannelEventRow[],
  tenantId?: string,
): Promise<number> {
  if (rows.length === 0) return 0;

  const docs: IChannelEventDoc[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    docs[i] = {
      ts: row.ts,
      idempotency_key: row.idempotencyKey,
      meta: {
        ...(tenantId !== undefined && { tenant_id: tenantId }),
        channel_id: row.channel,
        account_id: row.accountId,
      },
      direction: row.direction,
      subject: row.subject,
      message_type: row.messageType,
    };
  }

  try {
    const result = await db
      .collection("channel_events")
      .insertMany(docs, { ordered: false });
    return result.insertedCount;
  } catch (err: unknown) {
    if (isMongoDuplicateKeyError(err)) {
      const inserted = (
        err as { result?: { insertedCount?: number } }
      ).result?.insertedCount;
      return typeof inserted === "number" ? inserted : 0;
    }
    throw err;
  }
}
