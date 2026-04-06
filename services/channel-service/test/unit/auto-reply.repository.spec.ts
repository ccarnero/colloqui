import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import { AutoReplyRepository } from "../../src/modules/auto-reply/auto-reply.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

describe("AutoReplyRepository", () => {
  it("insertRule inserts with options fields", async () => {
    const sql = createQueuedSql([[]], mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReplyRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    const repo = moduleRef.get(AutoReplyRepository);
    await repo.insertRule({
      id: "rule-1",
      tenantId: "tenant-a",
      accountId: "acc-1",
      channel: "whatsapp",
      triggerPattern: "hi",
      replyText: "hello",
    });

    expect(sql).toHaveBeenCalled();
  });

  it("loadActiveRules selects active rules", async () => {
    const sql = createQueuedSql([[]], mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReplyRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    const repo = moduleRef.get(AutoReplyRepository);
    await repo.loadActiveRules();
    expect(sql).toHaveBeenCalled();
  });
});
