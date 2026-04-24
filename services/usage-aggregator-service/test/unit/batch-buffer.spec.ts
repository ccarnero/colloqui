import { describe, it, expect, mock } from "bun:test";
import type { Sql } from "@yoizen/database";
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

function makeSqlMock(behavior: "ok" | "error"): {
  sql: Sql;
  calls: { value: number };
} {
  const calls = { value: 0 };
  const fn = mock(() => {
    calls.value += 1;
    return behavior === "ok"
      ? Promise.resolve({ count: 1 })
      : Promise.reject(new Error("boom"));
  });
  const sql = Object.assign(fn, {
    array: (arr: unknown[]) => arr,
  }) as unknown as Sql;
  return { sql, calls };
}

describe("BatchBuffer", () => {
  it("flushes synchronously when batchSize is reached", async () => {
    const { sql, calls } = makeSqlMock("ok");
    const onSuccess = mock();
    const buf = new BatchBuffer({
      sql,
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
    const { sql, calls } = makeSqlMock("error");
    const onFailure = mock();
    const buf = new BatchBuffer({
      sql,
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
    const { sql, calls } = makeSqlMock("ok");
    const buf = new BatchBuffer({
      sql,
      batchSize: 100,
      batchFlushMs: 10_000,
    });
    const p1 = buf.enqueue(makeRow("k1"));
    await buf.stop();
    await p1;
    expect(calls.value).toBe(1);
  });

  it("rejects enqueue after stop()", async () => {
    const { sql } = makeSqlMock("ok");
    const buf = new BatchBuffer({
      sql,
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
