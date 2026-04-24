import { describe, it, expect, mock } from "bun:test";
import type { Sql } from "@yoizen/database";
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

function makeSqlMock(count: number): {
  sql: Sql;
  capturedArrays: unknown[][];
  callCount: { value: number };
} {
  const capturedArrays: unknown[][] = [];
  const callCount = { value: 0 };
  const fn = mock((..._args: unknown[]) => {
    callCount.value += 1;
    return Promise.resolve({ count });
  });
  const sql = Object.assign(fn, {
    array: (arr: unknown[]) => {
      capturedArrays.push(arr);
      return arr;
    },
  }) as unknown as Sql;
  return { sql, capturedArrays, callCount };
}

describe("insertBatch", () => {
  it("short-circuits on an empty batch (no SQL round-trip)", async () => {
    const { sql, callCount } = makeSqlMock(0);
    const inserted = await insertBatch(sql, []);
    expect(inserted).toBe(0);
    expect(callCount.value).toBe(0);
  });

  it("sends 7 parallel arrays aligned with the UNNEST column order", async () => {
    const { sql, capturedArrays } = makeSqlMock(2);
    const rows = [
      makeRow({ idempotencyKey: "k1", direction: "ingress" }),
      makeRow({ idempotencyKey: "k2", direction: "egress" }),
    ];
    const count = await insertBatch(sql, rows);
    expect(count).toBe(2);
    expect(capturedArrays).toHaveLength(7);
    expect(capturedArrays[1]).toEqual(["k1", "k2"]);
    expect(capturedArrays[4]).toEqual(["ingress", "egress"]);
  });

  it("uses rows.length when the driver does not report a count", async () => {
    const capturedArrays: unknown[][] = [];
    const fn = mock(() => Promise.resolve({}));
    const sql = Object.assign(fn, {
      array: (arr: unknown[]) => {
        capturedArrays.push(arr);
        return arr;
      },
    }) as unknown as Sql;
    const rows = [makeRow(), makeRow({ idempotencyKey: "k2" })];
    const count = await insertBatch(sql, rows);
    expect(count).toBe(rows.length);
  });
});
