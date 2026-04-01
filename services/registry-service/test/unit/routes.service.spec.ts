import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Sql } from "postgres";
import { RoutesService } from "../../src/modules/routes/routes.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

type SqlResult = unknown[] | { count: number };

function createSqlMock(sequence: SqlResult[]) {
  let idx = 0;
  const fn = mock(() => {
    const next = sequence[idx++];
    return Promise.resolve(next ?? []);
  });
  return Object.assign(fn, {
    json: (v: unknown) => v,
  }) as unknown as Sql;
}

describe("RoutesService", () => {
  let service: RoutesService;

  async function compileWithSql(sql: Sql) {
    const module = await Test.createTestingModule({
      providers: [RoutesService, { provide: POSTGRES_SQL, useValue: sql }],
    }).compile();
    return module.get(RoutesService);
  }

  describe("create", () => {
    it("creates route when service exists", async () => {
      const sql = createSqlMock([
        [{ id: "svc-1" }],
        [
          {
            id: "route-1",
            service_id: "svc-1",
            path_prefix: "/api",
            methods: ["GET"],
            is_public: false,
            strip_prefix: true,
            created_at: "2020-01-01T00:00:00.000Z",
          },
        ],
      ]);
      service = await compileWithSql(sql);
      const route = await service.create("tenant-a", "svc-1", {
        pathPrefix: "/api",
        methods: ["GET"],
      });
      expect(route.pathPrefix).toBe("/api");
      expect(route.serviceId).toBe("svc-1");
    });

    it("throws NotFoundException when service missing", async () => {
      const sql = createSqlMock([[]]);
      service = await compileWithSql(sql);
      await expect(
        service.create("tenant-a", "missing", { pathPrefix: "/x" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("maps unique violation to ConflictException", async () => {
      let calls = 0;
      const sql = Object.assign(
        mock(() => {
          calls += 1;
          if (calls === 1) return Promise.resolve([{ id: "svc-1" }]);
          return Promise.reject(Object.assign(new Error("dup"), { code: "23505" }));
        }),
        { json: (v: unknown) => v },
      ) as unknown as Sql;
      service = await compileWithSql(sql);
      await expect(
        service.create("tenant-a", "svc-1", { pathPrefix: "/api" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("listForService", () => {
    it("returns routes for valid service", async () => {
      const sql = createSqlMock([
        [{ id: "svc-1" }],
        [
          {
            id: "r1",
            service_id: "svc-1",
            path_prefix: "/a",
            methods: ["GET"],
            is_public: true,
            strip_prefix: false,
            created_at: "2020-01-01T00:00:00.000Z",
          },
        ],
      ]);
      service = await compileWithSql(sql);
      const routes = await service.listForService("tenant-a", "svc-1");
      expect(routes).toHaveLength(1);
      expect(routes[0].methods).toEqual(["GET"]);
    });

    it("throws NotFoundException when service missing", async () => {
      const sql = createSqlMock([[]]);
      service = await compileWithSql(sql);
      await expect(
        service.listForService("tenant-a", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("remove", () => {
    it("throws when service not found", async () => {
      const sql = createSqlMock([[]]);
      service = await compileWithSql(sql);
      await expect(
        service.remove("tenant-a", "svc-1", "route-1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException when no row deleted", async () => {
      const sql = createSqlMock([[{ id: "svc-1" }], { count: 0 }]);
      service = await compileWithSql(sql);
      await expect(
        service.remove("tenant-a", "svc-1", "bad-route"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("discover", () => {
    it("returns joined discovery rows", async () => {
      const sql = createSqlMock([
        [
          {
            id: "r1",
            tenant_id: "t1",
            service_name: "svc",
            knative_name: "svc-t1",
            namespace: "t1-dev-ns",
            port: 3000,
            path_prefix: "/p",
            methods: ["GET"],
            is_public: true,
            strip_prefix: true,
          },
        ],
      ]);
      service = await compileWithSql(sql);
      const entries = await service.discover();
      expect(entries).toHaveLength(1);
      expect(entries[0].tenantId).toBe("t1");
      expect(entries[0].pathPrefix).toBe("/p");
    });
  });
});
