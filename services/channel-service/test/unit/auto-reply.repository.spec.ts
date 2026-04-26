import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import { AutoReplyRepository } from "../../src/modules/auto-reply/auto-reply.repository";
import { ChannelTenantConnectionManager } from "../../src/providers/channel-tenant-connection-manager";

function wrapTcm(sql: ReturnType<typeof createQueuedSql>) {
  return {
    ensureSchema: mock(() => Promise.resolve(sql)),
  };
}

describe("AutoReplyRepository", () => {
  it("insertRule inserts with options fields", async () => {
    const sql = createQueuedSql([[]], mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReplyRepository,
        {
          provide: ChannelTenantConnectionManager,
          useValue: wrapTcm(sql),
        },
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

  it("listActiveRulesForTenant selects active rules for tenant", async () => {
    const sql = createQueuedSql([[]], mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReplyRepository,
        {
          provide: ChannelTenantConnectionManager,
          useValue: wrapTcm(sql),
        },
      ],
    }).compile();

    const repo = moduleRef.get(AutoReplyRepository);
    await repo.listActiveRulesForTenant("tenant-a");
    expect(sql).toHaveBeenCalled();
  });
});
