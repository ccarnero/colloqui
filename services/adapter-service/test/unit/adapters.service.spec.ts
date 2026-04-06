import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { AdaptersRepository } from "../../src/modules/adapters/adapters.repository";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import { makeSqlTestDouble } from "../make-sql-mock";
import type {
  CreateAdapterDto,
  CreateEndpointDto,
} from "../../src/modules/adapters/adapters.dto";
import type { Sql } from "postgres";

async function createAdaptersServiceWithSql(
  sql: Sql,
): Promise<AdaptersService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AdaptersRepository,
      AdaptersService,
      { provide: POSTGRES_SQL, useValue: sql },
    ],
  }).compile();
  return moduleRef.get(AdaptersService);
}

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

describe("AdaptersService", () => {
  const baseDto: CreateAdapterDto = {
    name: "Adapter One",
    context: "internal",
    baseUrl: "https://api.example.com",
  };

  describe("create", () => {
    let service: AdaptersService;

    beforeEach(async () => {
      const sql = makeSqlTestDouble((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("INSERT INTO http_adapters")) {
          return Promise.resolve([adapterRow]);
        }
        return Promise.resolve([]);
      });

      service = await createAdaptersServiceWithSql(sql);
    });

    it("inserts an adapter and maps the result", async () => {
      const result = await service.create("t1", baseDto);
      expect(result.id).toBe("a1");
      expect(result.name).toBe("Adapter One");
      expect(result.endpoints).toEqual([]);
    });

    it("maps 23505 to ConflictException", async () => {
      const sql = makeSqlTestDouble(() =>
        Promise.reject(
          Object.assign(new Error("duplicate"), { code: "23505" }),
        ),
      );
      const svc = await createAdaptersServiceWithSql(sql);

      await expect(svc.create("t1", baseDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("list", () => {
    it("returns empty array when no adapters", async () => {
      const sql = makeSqlTestDouble((strings) => {
        if ((strings[0] ?? "").includes("FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      const rows = await service.list("t1", undefined, 50, 0);
      expect(rows).toEqual([]);
    });

    it("returns adapters with endpoints", async () => {
      let step = 0;
      const sql = makeSqlTestDouble((strings) => {
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
      const service = await createAdaptersServiceWithSql(sql);

      const rows = await service.list("t1", undefined, 50, 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.endpoints).toHaveLength(1);
      expect(rows[0]?.endpoints[0]?.path).toBe("/v1");
    });
  });

  describe("get", () => {
    it("throws NotFoundException when adapter missing", async () => {
      const sql = makeSqlTestDouble((strings) => {
        if ((strings[0] ?? "").includes("FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await expect(service.get("t1", "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns adapter with endpoints", async () => {
      let step = 0;
      const sql = makeSqlTestDouble((strings) => {
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
      const service = await createAdaptersServiceWithSql(sql);

      const row = await service.get("t1", "a1");
      expect(row.id).toBe("a1");
      expect(row.endpoints).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("throws when adapter does not exist", async () => {
      const sql = makeSqlTestDouble((strings) => {
        if ((strings[0] ?? "").includes("FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await expect(
        service.update("t1", "a1", { name: "x" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("applies partial update and returns fresh row", async () => {
      const sql = makeSqlTestDouble((strings) => {
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
      const service = await createAdaptersServiceWithSql(sql);

      const row = await service.update("t1", "a1", { name: "Renamed" });
      expect(row.name).toBe("Renamed");
    });
  });

  describe("remove", () => {
    it("throws when nothing deleted", async () => {
      const sql = makeSqlTestDouble((strings) => {
        if ((strings[0] ?? "").includes("DELETE FROM http_adapters")) {
          return Promise.resolve({ count: 0 } as never);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await expect(service.remove("t1", "a1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("deletes when row exists", async () => {
      const sql = makeSqlTestDouble((strings) => {
        if ((strings[0] ?? "").includes("DELETE FROM http_adapters")) {
          return Promise.resolve({ count: 1 } as never);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await service.remove("t1", "a1");
    });
  });

  describe("addEndpoint", () => {
    const epDto: CreateEndpointDto = {
      label: "Get Users",
      method: "GET",
      path: "/users",
    };

    it("adds an endpoint and returns mapped result", async () => {
      const newEpRow = {
        id: "e2",
        adapter_id: "a1",
        label: "Get Users",
        method: "GET",
        path: "/users",
        created_at: "2024-01-01T00:00:00.000Z",
      };

      const sql = makeSqlTestDouble((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("SELECT id FROM http_adapters")) {
          return Promise.resolve([{ id: "a1" }]);
        }
        if (head.includes("INSERT INTO adapter_endpoints")) {
          return Promise.resolve([newEpRow]);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      const result = await service.addEndpoint("t1", "a1", epDto);
      expect(result.id).toBe("e2");
      expect(result.adapterId).toBe("a1");
      expect(result.method).toBe("GET");
      expect(result.path).toBe("/users");
      expect(result.label).toBe("Get Users");
    });

    it("throws NotFoundException when adapter does not exist", async () => {
      const sql = makeSqlTestDouble((strings) => {
        if ((strings[0] ?? "").includes("SELECT id FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await expect(
        service.addEndpoint("t1", "missing", epDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws ConflictException on duplicate endpoint (23505)", async () => {
      let callIdx = 0;
      const sql = makeSqlTestDouble((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("SELECT id FROM http_adapters") && callIdx === 0) {
          callIdx++;
          return Promise.resolve([{ id: "a1" }]);
        }
        if (head.includes("INSERT INTO adapter_endpoints")) {
          return Promise.reject(
            Object.assign(new Error("duplicate"), { code: "23505" }),
          );
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await expect(
        service.addEndpoint("t1", "a1", epDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("removeEndpoint", () => {
    it("removes an existing endpoint", async () => {
      let callIdx = 0;
      const sql = makeSqlTestDouble((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("SELECT id FROM http_adapters") && callIdx === 0) {
          callIdx++;
          return Promise.resolve([{ id: "a1" }]);
        }
        if (head.includes("DELETE FROM adapter_endpoints")) {
          return Promise.resolve({ count: 1 } as never);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await service.removeEndpoint("t1", "a1", "e1");
    });

    it("throws NotFoundException when adapter does not exist", async () => {
      const sql = makeSqlTestDouble((strings) => {
        if ((strings[0] ?? "").includes("SELECT id FROM http_adapters")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await expect(
        service.removeEndpoint("t1", "missing", "e1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException when endpoint does not exist", async () => {
      let callIdx = 0;
      const sql = makeSqlTestDouble((strings) => {
        const head = strings[0] ?? "";
        if (head.includes("SELECT id FROM http_adapters") && callIdx === 0) {
          callIdx++;
          return Promise.resolve([{ id: "a1" }]);
        }
        if (head.includes("DELETE FROM adapter_endpoints")) {
          return Promise.resolve({ count: 0 } as never);
        }
        return Promise.resolve([]);
      });
      const service = await createAdaptersServiceWithSql(sql);

      await expect(
        service.removeEndpoint("t1", "a1", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
