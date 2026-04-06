import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import type { Sql } from "postgres";
import { AccountsRepository } from "../../src/modules/accounts/accounts.repository";
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
    access_token: "tok",
    app_id: null,
    app_secret: null,
    verify_token: null,
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AccountsRepository", () => {
  it("insertAccount returns inserted row", async () => {
    const sql = createQueuedSql([[accountRow()]], mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    const repo = moduleRef.get(AccountsRepository);
    const rows = await repo.insertAccount({
      id: "acc-1",
      tenantId: "tenant-a",
      data: {
        channel: "whatsapp",
        provider: "meta",
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
    expect(sql).toHaveBeenCalled();
  });

  it("listByTenant filters by channel when provided", async () => {
    const sql = createQueuedSql([[accountRow()]], mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    const repo = moduleRef.get(AccountsRepository);
    const rows = await repo.listByTenant("tenant-a", "whatsapp");
    expect(rows).toHaveLength(1);
    expect(sql).toHaveBeenCalled();
  });

  it("updateAccount delegates to sql.unsafe when patch non-empty", async () => {
    const unsafe = mock(() => Promise.resolve([accountRow({ name: "Renamed" })]));
    const fn = mock(() => Promise.resolve([]));
    const sql = Object.assign(fn, {
      json: (v: unknown) => v,
      unsafe: unsafe,
    }) as unknown as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    const repo = moduleRef.get(AccountsRepository);
    const rows = await repo.updateAccount("tenant-a", "acc-1", {
      name: "Renamed",
    });

    expect(rows).toHaveLength(1);
    expect(unsafe).toHaveBeenCalled();
  });
});
