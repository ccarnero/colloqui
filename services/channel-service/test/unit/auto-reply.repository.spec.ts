import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AutoReplyMongoRepository } from "../../src/modules/auto-reply/auto-reply.mongo.repository";
import { ChannelTenantConnectionManager } from "../../src/providers/channel-tenant-connection-manager";
import { makeFakeTenantMongoConnections, makeMockDb } from "../make-mongo-mock";

describe("AutoReplyMongoRepository", () => {
  it("insertRule inserts with options fields", async () => {
    const insertOne = mock(async () => ({ acknowledged: true }));
    const db = makeMockDb({
      auto_reply_rules: { insertOne },
    });
    const tcm = makeFakeTenantMongoConnections(db);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReplyMongoRepository,
        {
          provide: ChannelTenantConnectionManager,
          useValue: tcm,
        },
      ],
    }).compile();

    const repo = moduleRef.get(AutoReplyMongoRepository);
    await repo.insertRule({
      id: "rule-1",
      tenantId: "tenant-a",
      accountId: "acc-1",
      channel: "whatsapp",
      triggerPattern: "hi",
      replyText: "hello",
    });

    expect(insertOne).toHaveBeenCalled();
  });

  it("listActiveRulesForTenant selects active rules for tenant", async () => {
    const toArray = mock(async () => []);
    const find = mock(() => ({ toArray }));
    const db = makeMockDb({
      auto_reply_rules: { find },
    });
    const tcm = makeFakeTenantMongoConnections(db);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReplyMongoRepository,
        {
          provide: ChannelTenantConnectionManager,
          useValue: tcm,
        },
      ],
    }).compile();

    const repo = moduleRef.get(AutoReplyMongoRepository);
    await repo.listActiveRulesForTenant("tenant-a");
    expect(find).toHaveBeenCalledWith({ is_active: true });
  });
});
