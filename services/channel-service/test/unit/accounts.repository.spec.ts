import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Db } from "mongodb";
import { AccountsMongoRepository } from "../../src/modules/accounts/accounts.mongo.repository";
import { ChannelTenantConnectionManager } from "../../src/providers/channel-tenant-connection-manager";
import { makeFakeTenantMongoConnections, makeMockDb } from "../make-mongo-mock";

function accountDoc(overrides: Record<string, unknown> = {}) {
  const now = new Date("2020-01-01T00:00:00.000Z");
  return {
    _id: "acc-1",
    channel: "telegram",
    provider: "telegram",
    name: "Primary",
    external_id: "ext-1",
    phone_number_id: null,
    waba_id: null,
    ig_user_id: null,
    telegram_bot_token: null,
    access_token: "tok",
    app_id: null,
    app_secret: null,
    verify_token: null,
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("AccountsMongoRepository", () => {
  it("insertAccount returns inserted row", async () => {
    const insertOne = mock(async () => ({ acknowledged: true }));
    const db = makeMockDb({
      channel_accounts: { insertOne },
    });
    const tcm = makeFakeTenantMongoConnections(db);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsMongoRepository,
        {
          provide: ChannelTenantConnectionManager,
          useValue: tcm,
        },
      ],
    }).compile();

    const repo = moduleRef.get(AccountsMongoRepository);
    const rows = await repo.insertAccount({
      id: "acc-1",
      tenantId: "tenant-a",
      data: {
        channel: "telegram",
        provider: "telegram",
        name: "Primary",
        externalId: "ext-1",
        phoneNumberId: null,
        wabaId: null,
        igUserId: null,
        telegramBotToken: null,
        accessToken: "tok",
        appId: null,
        verifyToken: null,
        isActive: true,
      },
      appSecret: null,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("acc-1");
    expect(insertOne).toHaveBeenCalled();
  });

  it("listByTenant filters by channel when provided", async () => {
    const toArray = mock(async () => [accountDoc()]);
    const sort = mock(() => ({ toArray }));
    const find = mock(() => ({ sort }));
    const db = makeMockDb({
      channel_accounts: { find },
    });
    const tcm = makeFakeTenantMongoConnections(db);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsMongoRepository,
        {
          provide: ChannelTenantConnectionManager,
          useValue: tcm,
        },
      ],
    }).compile();

    const repo = moduleRef.get(AccountsMongoRepository);
    const rows = await repo.listByTenant("tenant-a", "telegram");
    expect(rows).toHaveLength(1);
    expect(find).toHaveBeenCalledWith({ channel: "telegram" });
  });

  it("updateAccount applies patch via findOneAndUpdate", async () => {
    const findOneAndUpdate = mock(async () =>
      accountDoc({ name: "Renamed" }),
    );
    const db = makeMockDb({
      channel_accounts: { findOneAndUpdate },
    });
    const tcm = makeFakeTenantMongoConnections(db);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsMongoRepository,
        {
          provide: ChannelTenantConnectionManager,
          useValue: tcm,
        },
      ],
    }).compile();

    const repo = moduleRef.get(AccountsMongoRepository);
    const rows = await repo.updateAccount("tenant-a", "acc-1", {
      name: "Renamed",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Renamed");
    expect(findOneAndUpdate).toHaveBeenCalled();
  });
});
