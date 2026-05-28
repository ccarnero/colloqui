process.env.DB_ENGINE = "mongo";

import { describe, it, expect, mock } from "bun:test";
import type { Db } from "mongodb";
import { insertBatch } from "../../src/modules/aggregator/batch-inserter";
import type { IChannelEventRow } from "../../src/modules/aggregator/envelope-parser";

function makeRow(overrides: Partial<IChannelEventRow> = {}): IChannelEventRow {
  return {
    ts: new Date("2026-04-23T10:00:00.000Z"),
    idempotencyKey: "k1",
    accountId: "acct-1",
    channel: "whatsapp",
    direction: "ingress",
    subject: "ingress.whatsapp.received",
    messageType: "text",
    ...overrides,
  };
}

function makeDbMock(insertedCount: number): {
  db: Db;
  capturedDocs: unknown[][];
  callCount: { value: number };
} {
  const capturedDocs: unknown[][] = [];
  const callCount = { value: 0 };
  const insertMany = mock(async (docs: unknown[]) => {
    callCount.value += 1;
    capturedDocs.push(docs);
    return { insertedCount };
  });
  const db = {
    collection: mock(() => ({ insertMany })),
  } as unknown as Db;
  return { db, capturedDocs, callCount };
}

describe("insertBatch", () => {
  it("short-circuits on an empty batch (no Mongo round-trip)", async () => {
    const { db, callCount } = makeDbMock(0);
    const inserted = await insertBatch(db, []);
    expect(inserted).toBe(0);
    expect(callCount.value).toBe(0);
  });

  it("inserts time-series docs with meta subdocument", async () => {
    const { db, capturedDocs } = makeDbMock(2);
    const rows = [
      makeRow({ idempotencyKey: "k1", direction: "ingress" }),
      makeRow({ idempotencyKey: "k2", direction: "egress" }),
    ];
    const count = await insertBatch(db, rows);
    expect(count).toBe(2);
    expect(capturedDocs).toHaveLength(1);
    const docs = capturedDocs[0] as Array<{
      idempotency_key: string;
      meta: { channel_id: string; account_id: string };
      direction: string;
    }>;
    expect(docs[0]!.idempotency_key).toBe("k1");
    expect(docs[0]!.meta.channel_id).toBe("whatsapp");
    expect(docs[0]!.meta.account_id).toBe("acct-1");
    expect(docs[1]!.direction).toBe("egress");
  });

  it("adds tenant_id to meta for shared Mongo usage DB", async () => {
    const { db, capturedDocs } = makeDbMock(2);
    const rows = [
      makeRow({ idempotencyKey: "k1", direction: "ingress" }),
      makeRow({ idempotencyKey: "k2", direction: "dlq" }),
    ];
    const count = await insertBatch(db, rows, "tenant-a");
    expect(count).toBe(2);
    const docs = capturedDocs[0] as Array<{
      meta: { tenant_id: string; channel_id: string };
      direction: string;
    }>;
    expect(docs[0]!.meta.tenant_id).toBe("tenant-a");
    expect(docs[1]!.direction).toBe("dlq");
  });

  it("returns insertedCount from duplicate-key partial success", async () => {
    const insertMany = mock(async () => {
      const err = new Error("duplicate key") as Error & {
        code: number;
        result: { insertedCount: number };
      };
      err.code = 11000;
      err.result = { insertedCount: 1 };
      throw err;
    });
    const db = {
      collection: mock(() => ({ insertMany })),
    } as unknown as Db;
    const rows = [makeRow(), makeRow({ idempotencyKey: "k2" })];
    const count = await insertBatch(db, rows);
    expect(count).toBe(1);
  });
});
