import "../../setup-env";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { SKBContainersService } from "../../src/modules/structured-kb/skb-containers.service";
import type {
  FileRow,
  SKBContainerRow,
  SKBContainerStatus,
} from "../../src/modules/structured-kb/types/skb.types";

describe("SKBContainersService", () => {
  let service: SKBContainersService;
  let mockRepository: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    createFile: ReturnType<typeof vi.fn>;
  };
  const TENANT_ID = "tenant-123";

  function buildContainer(
    overrides: Partial<SKBContainerRow> = {}
  ): SKBContainerRow {
    return {
      id: "container-1",
      tenant_id: TENANT_ID,
      name: "Test Container",
      description: null,
      status: "pending" as SKBContainerStatus,
      version: "v1",
      ingest_model: "gpt-4.1-mini",
      query_model: "gpt-4.1-mini",
      provider_config: {},
      is_active: true,
      created_at: new Date("2026-06-01T00:00:00Z"),
      updated_at: new Date("2026-06-01T00:00:00Z"),
      ...overrides,
    };
  }

  beforeEach(() => {
    mockRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      createFile: vi.fn(),
    };

    service = new SKBContainersService(mockRepository as any);
  });

  // ---------------------------------------------------------------------------
  // createContainer
  // ---------------------------------------------------------------------------
  describe("createContainer", () => {
    it("should create a container with status 'pending'", async () => {
      const expected = buildContainer({ id: "new-id" });
      mockRepository.create.mockResolvedValue(expected);

      const result = await service.createContainer(TENANT_ID, "Test Container");

      expect(result.status).toBe("pending");
      expect(result.id).toBe("new-id");
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, {
        name: "Test Container",
        description: undefined,
      });
    });

    it("should create a container with optional description", async () => {
      const expected = buildContainer({
        id: "new-id",
        description: "My description",
      });
      mockRepository.create.mockResolvedValue(expected);

      const result = await service.createContainer(
        TENANT_ID,
        "Test Container",
        "My description"
      );

      expect(result.description).toBe("My description");
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, {
        name: "Test Container",
        description: "My description",
      });
    });

    it("should default description to undefined when omitted", async () => {
      const expected = buildContainer({ id: "noid" });
      mockRepository.create.mockResolvedValue(expected);

      await service.createContainer(TENANT_ID, "Minimal");

      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, {
        name: "Minimal",
        description: undefined,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getContainer
  // ---------------------------------------------------------------------------
  describe("getContainer", () => {
    it("should return a container by id", async () => {
      const expected = buildContainer();
      mockRepository.findById.mockResolvedValue(expected);

      const result = await service.getContainer(TENANT_ID, "container-1");

      expect(result).toEqual(expected);
      expect(mockRepository.findById).toHaveBeenCalledWith(
        TENANT_ID,
        "container-1"
      );
    });

    it("should throw NotFoundException when container does not exist", async () => {
      mockRepository.findById.mockResolvedValue(null);

      expect(service.getContainer(TENANT_ID, "nonexistent")).rejects.toThrow(
        NotFoundException
      );
      expect(mockRepository.findById).toHaveBeenCalledWith(
        TENANT_ID,
        "nonexistent"
      );
    });

    it("should pass through the repository error for other failures", async () => {
      mockRepository.findById.mockRejectedValue(
        new Error("DB connection failed")
      );

      expect(service.getContainer(TENANT_ID, "container-1")).rejects.toThrow(
        "DB connection failed"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // listContainers
  // ---------------------------------------------------------------------------
  describe("listContainers", () => {
    it("should return all active containers for a tenant", async () => {
      const expected = [
        buildContainer(),
        buildContainer({ id: "c2", name: "Container 2" }),
      ];
      mockRepository.findAll.mockResolvedValue(expected);

      const result = await service.listContainers(TENANT_ID);

      expect(result).toHaveLength(2);
      expect(result).toEqual(expected);
      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID);
    });

    it("should return empty array when no containers exist", async () => {
      mockRepository.findAll.mockResolvedValue([]);

      const result = await service.listContainers(TENANT_ID);

      expect(result).toEqual([]);
      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID);
    });

    it("should not return inactive containers", async () => {
      const active = buildContainer();
      mockRepository.findAll.mockResolvedValue([active]);

      const result = await service.listContainers(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result.every((c: SKBContainerRow) => c.is_active)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // updateContainer
  // ---------------------------------------------------------------------------
  describe("updateContainer", () => {
    it("should partially update container fields", async () => {
      const updated = buildContainer({
        name: "Updated Name",
        description: "New desc",
      });
      mockRepository.update.mockResolvedValue(updated);

      const result = await service.updateContainer(TENANT_ID, "container-1", {
        name: "Updated Name",
        description: "New desc",
      });

      expect(result.name).toBe("Updated Name");
      expect(mockRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        "container-1",
        {
          name: "Updated Name",
          description: "New desc",
        }
      );
    });

    it("should update only provided fields", async () => {
      const updated = buildContainer({ name: "Only Name Changed" });
      mockRepository.update.mockResolvedValue(updated);

      await service.updateContainer(TENANT_ID, "container-1", {
        name: "Only Name Changed",
      });

      expect(mockRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        "container-1",
        { name: "Only Name Changed" }
      );
    });

    it("should throw NotFoundException when updating nonexistent container", async () => {
      mockRepository.update.mockResolvedValue(null);

      expect(
        service.updateContainer(TENANT_ID, "nonexistent", { name: "X" })
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteContainer
  // ---------------------------------------------------------------------------
  describe("deleteContainer", () => {
    it("should soft delete by setting is_active = false", async () => {
      const deleted = buildContainer({ is_active: false });
      mockRepository.delete.mockResolvedValue(deleted);

      await service.deleteContainer(TENANT_ID, "container-1");

      expect(mockRepository.delete).toHaveBeenCalledWith(
        TENANT_ID,
        "container-1"
      );
    });

    it("should throw NotFoundException when deleting nonexistent container", async () => {
      mockRepository.delete.mockRejectedValue(new NotFoundException());

      expect(service.deleteContainer(TENANT_ID, "nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should not hard-delete the row", async () => {
      const deleted = buildContainer({ is_active: false });
      mockRepository.delete.mockResolvedValue(deleted);

      const result = await service.deleteContainer(TENANT_ID, "container-1");

      // After soft delete the object still has an id
      expect(result).toBeDefined();
      expect(result.is_active).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // containerExists
  // ---------------------------------------------------------------------------
  describe("containerExists", () => {
    it("should return true when container exists and is active", async () => {
      mockRepository.exists.mockResolvedValue(true);

      const result = await service.containerExists(TENANT_ID, "container-1");

      expect(result).toBe(true);
      expect(mockRepository.exists).toHaveBeenCalledWith(
        TENANT_ID,
        "container-1"
      );
    });

    it("should return false when container does not exist", async () => {
      mockRepository.exists.mockResolvedValue(false);

      const result = await service.containerExists(TENANT_ID, "nonexistent");

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // createFile
  // ---------------------------------------------------------------------------
  describe("createFile", () => {
    it("delegates to the repository and returns the created row", async () => {
      const expected = {
        id: "row-1",
        container_id: "container-1",
        tenant_id: TENANT_ID,
        file_id: "file-1",
        original_name: "sales.csv",
        detected_encoding: null,
        categories: ["cat-1"],
        row_count: 0,
        status: "pending",
        error_message: null,
        is_active: true,
        created_at: new Date("2026-06-01T00:00:00Z"),
        updated_at: new Date("2026-06-01T00:00:00Z"),
      } as unknown as FileRow;
      mockRepository.createFile.mockResolvedValue(expected);

      const result = await service.createFile(TENANT_ID, "container-1", {
        fileId: "file-1",
        originalName: "sales.csv",
        categories: ["cat-1"],
      });

      expect(result).toEqual(expected);
      expect(mockRepository.createFile).toHaveBeenCalledWith(
        TENANT_ID,
        "container-1",
        {
          fileId: "file-1",
          originalName: "sales.csv",
          categories: ["cat-1"],
        }
      );
    });
  });
});
