import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import type { Sql } from "postgres";
import { AccountsService } from "../../src/modules/accounts/accounts.service";
import { AccountsRepository } from "../../src/modules/accounts/accounts.repository";
import { TelegramProvider } from "../../src/providers/telegram/telegram.provider";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    tenant_id: "tenant-a",
    channel: "whatsapp",
    provider: "meta",
    name: "Primary",
    external_id: "ext-1",
    phone_number_id: null,
    waba_id: null,
    ig_user_id: null,
    telegram_bot_token: null,
    access_token: "token",
    app_id: null,
    app_secret: null,
    verify_token: null,
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AccountsService", () => {
  let registerWebhook: ReturnType<typeof mock>;

  async function compile(sql: Sql) {
    const module = await Test.createTestingModule({
      providers: [
        AccountsService,
        AccountsRepository,
        { provide: POSTGRES_SQL, useValue: sql },
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
    it("inserts WhatsApp account without Telegram webhook", async () => {
      const sql = createQueuedSql([[accountRow()]], mock);
      const service = await compile(sql);
      const acc = await service.create("tenant-a", {
        channel: "whatsapp",
        provider: "meta",
        name: "Primary",
        externalId: "ext-1",
        accessToken: "token",
        isActive: true,
      });
      expect(acc.channel).toBe("whatsapp");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("registers Telegram webhook for active telegram account", async () => {
      const sql = createQueuedSql(
        [
          [
            accountRow({
              channel: "telegram",
              provider: "telegram",
              telegram_bot_token: "bot-token",
              access_token: "bot-token",
            }),
          ],
        ],
        mock,
      );
      const service = await compile(sql);
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
  });

  describe("list", () => {
    it("returns accounts for tenant", async () => {
      const sql = createQueuedSql(
        [[accountRow(), accountRow({ id: "acc-2" })]],
        mock,
      );
      const service = await compile(sql);
      const list = await service.list("tenant-a");
      expect(list).toHaveLength(2);
    });
  });

  describe("findById", () => {
    it("returns null when missing", async () => {
      const sql = createQueuedSql([[]], mock);
      const service = await compile(sql);
      const acc = await service.findById("tenant-a", "missing");
      expect(acc).toBeNull();
    });

    it("returns account when found", async () => {
      const sql = createQueuedSql([[accountRow()]], mock);
      const service = await compile(sql);
      const acc = await service.findById("tenant-a", "acc-1");
      expect(acc?.id).toBe("acc-1");
    });
  });

  describe("update", () => {
    it("applies unsafe update and returns row", async () => {
      const updated = accountRow({ name: "Renamed" });
      const unsafe = mock(() => Promise.resolve([updated]));
      const sql = Object.assign(
        mock(() => Promise.resolve([])),
        {
          json: (v: unknown) => v,
          unsafe,
        },
      ) as unknown as Sql;
      const service = await compile(sql);
      const acc = await service.update("tenant-a", "acc-1", {
        name: "Renamed",
      });
      expect(acc?.name).toBe("Renamed");
      expect(unsafe).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("returns true when row deleted", async () => {
      const sql = Object.assign(
        mock(() => Promise.resolve({ count: 1 })),
        {
          json: (v: unknown) => v,
          unsafe: mock(() => Promise.resolve([])),
        },
      ) as unknown as Sql;
      const service = await compile(sql);
      const ok = await service.remove("tenant-a", "acc-1");
      expect(ok).toBe(true);
    });
  });
});
