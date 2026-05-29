process.env.DB_ENGINE = "mongo";

import { describe, it, expect, mock } from "bun:test";
import type { Db } from "mongodb";
import { BatchBuffer } from "../../src/modules/aggregator/batch-buffer";
import type { IChannelEventRow } from "../../src/modules/aggregator/envelope-parser";

function makeRow(key: string): IChannelEventRow {
  return {
    ts: new Date("2026-04-23T10:00:00.000Z"),
    idempotencyKey: key,
    accountId: "acct-1",
    channel: "whatsapp",
    direction: "ingress",
    subject: "ingress.whatsapp.received",
    messageType: "text",
  };
}

function makeDbMock(behavior: "ok" | "error"): {
  db: Db;
  calls: { value: number };
} {
  const calls = { value: 0 };
  const insertMany = mock(() => {
    calls.value += 1;
    return behavior === "ok"
      ? Promise.resolve({ insertedCount: 1 })
      : Promise.reject(new Error("boom"));
  });
  const db = {
    collection: mock(() => ({ insertMany })),
  } as unknown as Db;
  return { db, calls };
}

describe("BatchBuffer", () => {
  it("flushes synchronously when batchSize is reached", async () => {
    const { db, calls } = makeDbMock("ok");
    const onSuccess = mock();
    const buf = new BatchBuffer({
      connection: db,
      batchSize: 2,
      batchFlushMs: 10_000,
      hooks: {
        onFlushSuccess: onSuccess,
        onFlushFailure: mock(),
      },
    });

    const p1 = buf.enqueue(makeRow("k1"));
    const p2 = buf.enqueue(makeRow("k2"));
    await Promise.all([p1, p2]);

    expect(calls.value).toBe(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("rejects all waiters when a flush fails", async () => {
    const { db, calls } = makeDbMock("error");
    const onFailure = mock();
    const buf = new BatchBuffer({
      connection: db,
      batchSize: 2,
      batchFlushMs: 10_000,
      hooks: {
        onFlushSuccess: mock(),
        onFlushFailure: onFailure,
      },
    });

    const p1 = buf.enqueue(makeRow("k1")).catch((e) => (e as Error).message);
    const p2 = buf.enqueue(makeRow("k2")).catch((e) => (e as Error).message);
    const [m1, m2] = await Promise.all([p1, p2]);

    expect(calls.value).toBe(1);
    expect(m1).toBe("boom");
    expect(m2).toBe("boom");
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("flushes remaining rows when stopped", async () => {
    const { db, calls } = makeDbMock("ok");
    const buf = new BatchBuffer({
      connection: db,
      batchSize: 100,
      batchFlushMs: 10_000,
    });
    const p1 = buf.enqueue(makeRow("k1"));
    await buf.stop();
    await p1;
    expect(calls.value).toBe(1);
  });

  it("rejects enqueue after stop()", async () => {
    const { db } = makeDbMock("ok");
    const buf = new BatchBuffer({
      connection: db,
      batchSize: 100,
      batchFlushMs: 10_000,
    });
    await buf.stop();
    let message = "none";
    await buf.enqueue(makeRow("k1")).catch((e) => {
      message = (e as Error).message;
    });
    expect(message).toBe("BatchBuffer stopped");
  });
});
