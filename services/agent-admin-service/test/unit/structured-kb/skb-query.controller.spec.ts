import "../../setup-env";
import { describe, it, expect, mock, beforeEach, vi } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { StructuredKBController: Controller } = await import(
    "../../src/modules/structured-kb/structured-kb.controller"
  );
  const { SKBQueryService: QueryService } = await import(
    "../../src/modules/structured-kb/skb-query.service"
  );
  const { SKBContainersService: ContainersService } = await import(
    "../../src/modules/structured-kb/containers.service"
  );
  return { Controller, QueryService, ContainersService };
};

describe("StructuredKBController — Query Endpoint", () => {
  let controller: any;
  let queryService: {
    query: ReturnType<typeof mock>;
  };
  let containersService: {
    containerExists: ReturnType<typeof mock>;
    getContainer: ReturnType<typeof mock>;
  };

  const TENANT_ID = "tenant-123";
  const CONTAINER_ID = "container-abc";

  beforeEach(async () => {
    const mod = await load();

    queryService = {
      query: mock(() =>
        Promise.resolve({
          results: [
            { product: "Widget A", price: 49.99, region: "North" },
            { product: "Widget B", price: 29.99, region: "North" },
          ],
          sql: "SELECT data FROM skb_rows WHERE container_id = 'container-abc' AND tenant_id = 'tenant-123' AND ((data->>'region') = 'North') ORDER BY (data->>'price')::numeric DESC LIMIT 10 OFFSET 0",
          totalCount: 42,
        }),
      ),
    };

    containersService = {
      containerExists: mock(() => Promise.resolve(true)),
      getContainer: mock(() =>
        Promise.resolve({
          id: CONTAINER_ID,
          tenant_id: TENANT_ID,
          name: "Sales Data",
          status: "ready",
          query_model: "gpt-4.1-mini",
          provider_config: { provider: "openai", apiKey: "test-key" },
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [mod.Controller],
      providers: [
        { provide: mod.QueryService, useValue: queryService },
        { provide: mod.ContainersService, useValue: containersService },
      ],
    }).compile();

    controller = moduleRef.get(mod.Controller);
  });

  describe("POST /admin/structured-kb/containers/:id/query", () => {
    it("should accept { query: string } and return results", async () => {
      const result = await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show me sales in the North region",
      });

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("sql");
      expect(result).toHaveProperty("totalCount");
      expect(result.results).toHaveLength(2);
    });

    it("should accept optional categories", async () => {
      await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show sales",
        categories: ["sales"],
      });

      expect(queryService.query).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        "show sales",
        expect.objectContaining({ categories: ["sales"] }),
      );
    });

    it("should accept optional limit", async () => {
      await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show sales",
        limit: 20,
      });

      const call = queryService.query.mock.calls[0];
      expect(call).toBeDefined();
    });

    it("should accept optional offset", async () => {
      await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show sales",
        limit: 10,
        offset: 20,
      });

      expect(queryService.query).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        "show sales",
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });

    it("should require auth via tenant header (tenantId parameter)", async () => {
      expect(queryService.query).not.toHaveBeenCalled();

      await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show sales",
      });

      expect(queryService.query).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        "show sales",
        expect.anything(),
      );
    });
  });

  describe("input validation", () => {
    it("should reject empty query (400)", async () => {
      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, { query: "" }),
      ).rejects.toThrow();
    });

    it("should reject whitespace-only query (400)", async () => {
      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, { query: "   " }),
      ).rejects.toThrow();
    });

    it("should reject query exceeding max limit (> 1000)", async () => {
      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, {
          query: "show sales",
          limit: 1001,
        }),
      ).rejects.toThrow();
    });

    it("should reject negative limit", async () => {
      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, {
          query: "show sales",
          limit: -1,
        }),
      ).rejects.toThrow();
    });

    it("should reject zero limit", async () => {
      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, {
          query: "show sales",
          limit: 0,
        }),
      ).rejects.toThrow();
    });

    it("should reject negative offset", async () => {
      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, {
          query: "show sales",
          offset: -5,
        }),
      ).rejects.toThrow();
    });

    it("should accept limit of 1 (minimum valid)", async () => {
      const result = await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show sales",
        limit: 1,
      });

      expect(result).toHaveProperty("results");
    });

    it("should accept limit of 1000 (maximum valid)", async () => {
      const result = await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show sales",
        limit: 1000,
      });

      expect(result).toHaveProperty("results");
    });

    it("should use default limit of 10 when not specified", async () => {
      await controller.query(TENANT_ID, CONTAINER_ID, {
        query: "show sales",
      });

      const call = queryService.query.mock.calls[0];
      expect(call).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should return 422 when query service throws", async () => {
      queryService.query = mock(() =>
        Promise.reject(new Error("LLM translation failed")),
      );

      const mod = await load();
      const moduleRef = await Test.createTestingModule({
        controllers: [mod.Controller],
        providers: [
          { provide: mod.QueryService, useValue: queryService },
          { provide: mod.ContainersService, useValue: containersService },
        ],
      }).compile();
      controller = moduleRef.get(mod.Controller);

      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, {
          query: "show sales",
        }),
      ).rejects.toThrow();
    });

    it("should include descriptive error message from service", async () => {
      const errorMsg = "SQL safety violation: potentially dangerous pattern detected";
      queryService.query = mock(() => Promise.reject(new Error(errorMsg)));

      const mod = await load();
      const moduleRef = await Test.createTestingModule({
        controllers: [mod.Controller],
        providers: [
          { provide: mod.QueryService, useValue: queryService },
          { provide: mod.ContainersService, useValue: containersService },
        ],
      }).compile();
      controller = moduleRef.get(mod.Controller);

      await expect(
        controller.query(TENANT_ID, CONTAINER_ID, {
          query: "show sales",
        }),
      ).rejects.toThrow(errorMsg);
    });
  });

  describe("tenant isolation", () => {
    it("should pass tenant ID to query service for multi-tenant isolation", async () => {
      await controller.query("tenant-xyz", CONTAINER_ID, {
        query: "show sales",
      });

      expect(queryService.query).toHaveBeenCalledWith(
        "tenant-xyz",
        CONTAINER_ID,
        "show sales",
        expect.anything(),
      );
    });
  });
});
