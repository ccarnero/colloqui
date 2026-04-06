import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import type { Sql } from "@yoizen/database";
import { initYoizenClawTenantSchema } from "../../src/providers/yoizenclaw-schema-initializer";

describe("initYoizenClawTenantSchema", () => {
  it("runs tenant DDL inside a transaction", async () => {
    const unsafeCalls: string[] = [];
    const tx = {
      unsafe: (q: string) => {
        unsafeCalls.push(q);
        return Promise.resolve();
      },
    };
    const sql = {
      begin: async (fn: (inner: typeof tx) => Promise<void>) => {
        await fn(tx);
      },
    } as unknown as Sql;

    await initYoizenClawTenantSchema("tenant-1", sql);

    expect(
      unsafeCalls.some((c) => c.includes("CREATE TABLE IF NOT EXISTS agents")),
    ).toBe(true);
    expect(
      unsafeCalls.some((c) =>
        c.includes("CREATE TABLE IF NOT EXISTS job_executions"),
      ),
    ).toBe(true);
  });
});
