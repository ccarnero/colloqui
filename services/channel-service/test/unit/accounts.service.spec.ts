import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AccountsMongoRepository } from "../../src/modules/accounts/accounts.mongo.repository";
import { ACCOUNTS_REPOSITORY } from "../../src/modules/accounts/accounts.repository.interface";
import { AccountsService } from "../../src/modules/accounts/accounts.service";
import { ChannelTenantConnectionManager } from "../../src/providers/channel-tenant-connection-manager";
import { TelegramProvider } from "../../src/providers/telegram/telegram.provider";
import { makeFakeTenantMongoConnections, makeMockDb } from "../make-mongo-mock";

function accountDoc(overrides: Record<string, unknown> = {}) {
  const now = new Date("2020-01-01T00:00:00.000Z");
  return {
    _id: "acc-1",
    channel: "telegram",
    provider: "telegram",
    name: "Primary",
    external_id: "ext-1",
    telegram_bot_token: null,
    access_token: "token",
    app_secret: null,
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("AccountsService", () => {
  let registerWebhook: ReturnType<typeof mock>;

  async function compile(db: ReturnType<typeof makeMockDb>) {
    const tcm = makeFakeTenantMongoConnections(db);
    const module = await Test.createTestingModule({
      providers: [
        AccountsService,
        AccountsMongoRepository,
        { provide: ACCOUNTS_REPOSITORY, useExisting: AccountsMongoRepository },
        { provide: ChannelTenantConnectionManager, useValue: tcm },
        {
          provide: TelegramProvider,
          useValue: { registerWebhook },
        },
      ],
    }).compile();
    return module.get(AccountsService);
  }

  beforeEach(() => {
    registerWebhook = mock(() => Promise.resolve({ ok: true }));
  });

  describe("create", () => {
    it("inserts a non-Telegram account without registering a Telegram webhook", async () => {
      const insertOne = mock(async () => ({ acknowledged: true }));
      const db = makeMockDb({ channel_accounts: { insertOne } });
      const service = await compile(db);
      const acc = await service.create("tenant-a", {
        channel: "e2e-tests",
        provider: "e2e-tests",
        name: "Primary",
        externalId: "ext-1",
        accessToken: "token",
        isActive: true,
      });
      expect(acc.channel).toBe("e2e-tests");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("registers Telegram webhook for active telegram account", async () => {
      const insertOne = mock(async () => ({ acknowledged: true }));
      const db = makeMockDb({ channel_accounts: { insertOne } });
      const service = await compile(db);
      await service.create("tenant-a", {
        channel: "telegram",
        provider: "telegram",
        name: "Bot",
        externalId: "ext-tg",
        accessToken: "bot-token",
        telegramBotToken: "bot-token",
        isActive: true,
      });
      expect(registerWebhook).toHaveBeenCalled();
    });

    it("auto-generates appSecret for http account", async () => {
      const insertOne = mock(async () => ({ acknowledged: true }));
      const db = makeMockDb({ channel_accounts: { insertOne } });
      const service = await compile(db);
      const acc = await service.create("tenant-a", {
        channel: "http" as never,
        provider: "http" as never,
        name: "HTTP ingest",
        externalId: "http-source-1",
        accessToken: "placeholder",
        isActive: true,
      });
      expect(typeof acc.appSecret).toBe("string");
      expect((acc.appSecret ?? "").length).toBeGreaterThan(0);
    });

    it("does not call registerWebhook for http account", async () => {
      const insertOne = mock(async () => ({ acknowledged: true }));
      const db = makeMockDb({ channel_accounts: { insertOne } });
      const service = await compile(db);
      await service.create("tenant-a", {
        channel: "http" as never,
        provider: "http" as never,
        name: "HTTP ingest",
        externalId: "http-source-1",
        accessToken: "placeholder",
        isActive: true,
      });
      expect(registerWebhook).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("returns accounts for tenant", async () => {
      const toArray = mock(async () => [
        accountDoc(),
        accountDoc({ _id: "acc-2" }),
      ]);
      const sort = mock(() => ({ toArray }));
      const find = mock(() => ({ sort }));
      const db = makeMockDb({ channel_accounts: { find } });
      const service = await compile(db);
      const list = await service.list("tenant-a");
      expect(list).toHaveLength(2);
    });
  });

  describe("findById", () => {
    it("returns null when missing", async () => {
      const findOne = mock(async () => null);
      const db = makeMockDb({ channel_accounts: { findOne } });
      const service = await compile(db);
      const acc = await service.findById("tenant-a", "missing");
      expect(acc).toBeNull();
    });

    it("returns account when found", async () => {
      const findOne = mock(async () => accountDoc());
      const db = makeMockDb({ channel_accounts: { findOne } });
      const service = await compile(db);
      const acc = await service.findById("tenant-a", "acc-1");
      expect(acc?.id).toBe("acc-1");
    });
  });

  describe("update", () => {
    it("applies patch and returns row", async () => {
      const findOneAndUpdate = mock(async () =>
        accountDoc({ name: "Renamed" })
      );
      const db = makeMockDb({ channel_accounts: { findOneAndUpdate } });
      const service = await compile(db);
      const acc = await service.update("tenant-a", "acc-1", {
        name: "Renamed",
      });
      expect(acc?.name).toBe("Renamed");
      expect(findOneAndUpdate).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("returns true when row deleted", async () => {
      const deleteOne = mock(async () => ({ deletedCount: 1 }));
      const db = makeMockDb({ channel_accounts: { deleteOne } });
      const service = await compile(db);
      const ok = await service.remove("tenant-a", "acc-1");
      expect(ok).toBe(true);
    });
  });
});
