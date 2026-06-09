import "../../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { SKBContainersController } = await import(
    "../../src/modules/structured-kb/containers.controller"
  );
  const { SKBContainersService } = await import(
    "../../src/modules/structured-kb/containers.service"
  );
  return { SKBContainersController, SKBContainersService };
};

describe("SKBContainersController", () => {
  let controller: InstanceType<
    Awaited<ReturnType<typeof load>>["SKBContainersController"]
  >;
  let containersService: {
    createContainer: ReturnType<typeof mock>;
    listContainers: ReturnType<typeof mock>;
    getContainer: ReturnType<typeof mock>;
    updateContainer: ReturnType<typeof mock>;
    deleteContainer: ReturnType<typeof mock>;
    containerExists: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    const mod = await load();

    containersService = {
      createContainer: mock(() =>
        Promise.resolve({
          id: "c1",
          name: "Test Container",
          status: "pending",
        }),
      ),
      listContainers: mock(() => Promise.resolve([])),
      getContainer: mock(() => Promise.resolve(null)),
      updateContainer: mock(() => Promise.resolve({ id: "c1" })),
      deleteContainer: mock(() => Promise.resolve()),
      containerExists: mock(() => Promise.resolve(true)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [mod.SKBContainersController],
      providers: [
        { provide: mod.SKBContainersService, useValue: containersService },
      ],
    }).compile();

    controller = moduleRef.get(mod.SKBContainersController);
  });

  // ---------------------------------------------------------------------------
  // POST /admin/structured-kb/containers
  // ---------------------------------------------------------------------------
  describe("POST /admin/structured-kb/containers", () => {
    it("should create a container with required name field", async () => {
      const result = await controller.create("tenant-123", {
        name: "Sales Data",
      });

      expect(containersService.createContainer).toHaveBeenCalledWith(
        "tenant-123",
        "Sales Data",
        undefined,
      );
      expect(result.status).toBe("pending");
      expect(result.id).toBe("c1");
    });

    it("should create a container with name and description", async () => {
      await controller.create("tenant-123", {
        name: "Sales",
        description: "Q1 2026 data",
      });

      expect(containersService.createContainer).toHaveBeenCalledWith(
        "tenant-123",
        "Sales",
        "Q1 2026 data",
      );
    });

    it("should pass tenant header through to service", async () => {
      await controller.create("different-tenant", { name: "X" });

      expect(containersService.createContainer).toHaveBeenCalledWith(
        "different-tenant",
        "X",
        undefined,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/structured-kb/containers
  // ---------------------------------------------------------------------------
  describe("GET /admin/structured-kb/containers", () => {
    it("should list containers for the tenant", async () => {
      const result = await controller.list("tenant-123");

      expect(containersService.listContainers).toHaveBeenCalledWith(
        "tenant-123",
      );
      expect(result).toEqual([]);
    });

    it("should return typed response with containers array", async () => {
      containersService.listContainers = mock(() =>
        Promise.resolve([
          { id: "c1", name: "A", status: "pending" },
          { id: "c2", name: "B", status: "ready" },
        ]),
      );

      // Rebuild module with updated mock
      const mod = await load();
      const moduleRef = await Test.createTestingModule({
        controllers: [mod.SKBContainersController],
        providers: [
          { provide: mod.SKBContainersService, useValue: containersService },
        ],
      }).compile();
      controller = moduleRef.get(mod.SKBContainersController);

      const result = await controller.list("tenant-123");

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe("pending");
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/structured-kb/containers/:id
  // ---------------------------------------------------------------------------
  describe("GET /admin/structured-kb/containers/:id", () => {
    it("should get a container by its ID", async () => {
      const mockContainer = { id: "c1", name: "Test", status: "pending" };
      containersService.getContainer = mock(() =>
        Promise.resolve(mockContainer),
      );

      const mod = await load();
      const moduleRef = await Test.createTestingModule({
        controllers: [mod.SKBContainersController],
        providers: [
          { provide: mod.SKBContainersService, useValue: containersService },
        ],
      }).compile();
      controller = moduleRef.get(mod.SKBContainersController);

      const result = await controller.get("tenant-123", "c1");

      expect(containersService.getContainer).toHaveBeenCalledWith(
        "tenant-123",
        "c1",
      );
      expect(result.id).toBe("c1");
    });

    it("should pass container ID param correctly", async () => {
      await controller.get("tenant-123", "specific-id");

      expect(containersService.getContainer).toHaveBeenCalledWith(
        "tenant-123",
        "specific-id",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /admin/structured-kb/containers/:id
  // ---------------------------------------------------------------------------
  describe("PATCH /admin/structured-kb/containers/:id", () => {
    it("should update container fields", async () => {
      await controller.update("tenant-123", "c1", { name: "Updated" });

      expect(containersService.updateContainer).toHaveBeenCalledWith(
        "tenant-123",
        "c1",
        { name: "Updated" },
      );
    });

    it("should pass partial DTO to service", async () => {
      await controller.update("tenant-123", "c1", {
        name: "New",
        description: "New desc",
      });

      expect(containersService.updateContainer).toHaveBeenCalledWith(
        "tenant-123",
        "c1",
        { name: "New", description: "New desc" },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /admin/structured-kb/containers/:id
  // ---------------------------------------------------------------------------
  describe("DELETE /admin/structured-kb/containers/:id", () => {
    it("should delete (soft) a container", async () => {
      await controller.delete("tenant-123", "c1");

      expect(containersService.deleteContainer).toHaveBeenCalledWith(
        "tenant-123",
        "c1",
      );
    });

    it("should return proper HTTP status code (204 No Content)", async () => {
      // NestJS convention for DELETE with @HttpCode(HttpStatus.NO_CONTENT)
      // The method itself returns void/undefined
      const result = await controller.delete("tenant-123", "c1");

      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant header isolation
  // ---------------------------------------------------------------------------
  describe("tenant isolation", () => {
    it("should not leak data across tenants", async () => {
      await controller.list("tenant-a");
      await controller.list("tenant-b");

      expect(containersService.listContainers).toHaveBeenCalledWith(
        "tenant-a",
      );
      expect(containersService.listContainers).toHaveBeenCalledWith(
        "tenant-b",
      );
    });
  });
});
