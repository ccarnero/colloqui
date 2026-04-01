import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Sql } from "postgres";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type { CreateAdapterDto } from "../../src/modules/adapters/adapters.dto";

const adapterRow = {
  id: "a1",
  tenant_id: "t1",
  name: "Adapter One",
  context: "internal",
  base_url: "https://api.example.com",
  auth_type: "none",
  auth_config: {},
  headers: [] as Array<{ key: string; value: string }>,
  timeout_ms: 5000,
  max_retries: 3,
  retry_backoff_ms: 1000,
  health_check_path: "/health",
  status: "enabled" as const,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

const endpointRow = {
  id: "e1",
  adapter_id: "a1",
  label: "default",
  method: "GET",
  path: "/v1",
  created_at: "2024-01-01T00:00:00.000Z",
};

function makeSql(
  impl: (
    strings: TemplateStringsArray,
    values: unknown[],
  ) => Promise<unknown>,
): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) =>
    impl(strings, values);
  return Object.assign(fn, {
    json: (x: never) => x,
    unsafe: mock((_q: string, _p: unknown[]) => Promise.resolve(undefined)),
  }) as Sql;
}

describe("AdaptersService", () => {
  const baseDto: CreateAdapterDto = {
    name: "Adapter One",
    context: "internal",
    baseUrl: "https://api.example.com",
  };

  describe("create", () => {
    let service: AdaptersService;

    beforeEach(async () => {
      const sql = makeSql((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("INSERT INTO http_adapters")) {
          return Promise.resolve([adapterRow]);
        }
        return Promise.resolve([]);
      });

      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      service = moduleRef.get(AdaptersService);
    });

    it("inserts an adapter and maps the result", async () => {
      const result = await service.create("t1", baseDto);
      expect(result.id).toBe("a1");
      expect(result.name).toBe("Adapter One");
      expect(result.endpoints).toEqual([]);
    });

    it("maps 23505 to ConflictException", async () => {
      const sql = makeSql(() =>
        Promise.reject(Object.assign(new Error("duplicate"), { code: "23505" })),
      );
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const svc = moduleRef.get(AdaptersService);

      await expect(svc.create("t1", baseDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("list", () => {
    it("returns empty array when no adapters", async () => {
      const sql = makeSql((strings) => {
        if ((strings[0] ?? "").includes("FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      const rows = await service.list("t1");
      expect(rows).toEqual([]);
    });

    it("returns adapters with endpoints", async () => {
      let step = 0;
      const sql = makeSql((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("FROM http_adapters") && step === 0) {
          step += 1;
          return Promise.resolve([adapterRow]);
        }
        if (head.includes("FROM adapter_endpoints")) {
          return Promise.resolve([endpointRow]);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      const rows = await service.list("t1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.endpoints).toHaveLength(1);
      expect(rows[0]?.endpoints[0]?.path).toBe("/v1");
    });
  });

  describe("get", () => {
    it("throws NotFoundException when adapter missing", async () => {
      const sql = makeSql((strings) => {
        if ((strings[0] ?? "").includes("FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      await expect(service.get("t1", "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns adapter with endpoints", async () => {
      let step = 0;
      const sql = makeSql((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("FROM http_adapters") && step === 0) {
          step += 1;
          return Promise.resolve([adapterRow]);
        }
        if (head.includes("FROM adapter_endpoints")) {
          return Promise.resolve([endpointRow]);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      const row = await service.get("t1", "a1");
      expect(row.id).toBe("a1");
      expect(row.endpoints).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("throws when adapter does not exist", async () => {
      const sql = makeSql((strings) => {
        if ((strings[0] ?? "").includes("FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      await expect(
        service.update("t1", "a1", { name: "x" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("applies partial update and returns fresh row", async () => {
      const sql = makeSql((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("SELECT id FROM http_adapters")) {
          return Promise.resolve([{ id: "a1" }]);
        }
        if (head.includes("SELECT * FROM http_adapters")) {
          return Promise.resolve([{ ...adapterRow, name: "Renamed" }]);
        }
        if (head.includes("FROM adapter_endpoints")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      const row = await service.update("t1", "a1", { name: "Renamed" });
      expect(row.name).toBe("Renamed");
    });
  });

  describe("remove", () => {
    it("throws when nothing deleted", async () => {
      const sql = makeSql((strings) => {
        if ((strings[0] ?? "").includes("DELETE FROM http_adapters")) {
          return Promise.resolve({ count: 0 } as never);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      await expect(service.remove("t1", "a1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("deletes when row exists", async () => {
      const sql = makeSql((strings) => {
        if ((strings[0] ?? "").includes("DELETE FROM http_adapters")) {
          return Promise.resolve({ count: 1 } as never);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          AdaptersService,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const service = moduleRef.get(AdaptersService);

      await service.remove("t1", "a1");
    });
  });
});
