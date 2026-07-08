import "../../setup-env";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import { SKBContainersRepository } from "../../src/modules/structured-kb/skb-containers.repository";

/**
 * Covers DOC-VS-CODE-AUDIT.md SKB defect 3 — the watchdog's
 * `findProcessingFilesOlderThan` used to return `[]` unconditionally.
 * It now fans out over every known tenant, queries `skb_files` for stuck
 * rows per tenant, and isolates failures so one tenant's DB error never
 * blocks the check for the rest.
 */
describe("SKBContainersRepository.findProcessingFilesOlderThan (SKB defect 3)", () => {
  let mockConnectionManager: {
    getKnownTenantIds: ReturnType<typeof vi.fn>;
    ensureSchema: ReturnType<typeof vi.fn>;
  };
  let repository: SKBContainersRepository;

  function makeSqlTemplateFn(result: unknown[]) {
    // Tagged-template `sql` calls (`sql<T>\`...\``) invoke the function with
    // (strings, ...values); we only need it to resolve to `result`.
    const fn = vi.fn().mockResolvedValue(result);
    return fn;
  }

  beforeEach(() => {
    mockConnectionManager = {
      getKnownTenantIds: vi.fn().mockReturnValue([]),
      ensureSchema: vi.fn(),
    };
    repository = new SKBContainersRepository(mockConnectionManager as never);
  });

  it("returns [] when no tenant connections are known yet", async () => {
    mockConnectionManager.getKnownTenantIds.mockReturnValue([]);

    const result = await repository.findProcessingFilesOlderThan(10);

    expect(result).toEqual([]);
    expect(mockConnectionManager.ensureSchema).not.toHaveBeenCalled();
  });

  it("queries skb_files for each known tenant and aggregates stuck files", async () => {
    mockConnectionManager.getKnownTenantIds.mockReturnValue([
      "tenant-a",
      "tenant-b",
    ]);

    const stuckA = [
      {
        file_id: "file-a",
        container_id: "container-a",
        tenant_id: "tenant-a",
        status: "processing",
        updated_at: new Date(),
      },
    ];
    const stuckB = [
      {
        file_id: "file-b",
        container_id: "container-b",
        tenant_id: "tenant-b",
        status: "processing",
        updated_at: new Date(),
      },
    ];

    let call = 0;
    mockConnectionManager.ensureSchema.mockImplementation(async () => {
      call++;
      const result = call === 1 ? stuckA : stuckB;
      return makeSqlTemplateFn(result);
    });

    const result = await repository.findProcessingFilesOlderThan(10);

    expect(mockConnectionManager.ensureSchema).toHaveBeenCalledWith("tenant-a");
    expect(mockConnectionManager.ensureSchema).toHaveBeenCalledWith("tenant-b");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.file_id).sort()).toEqual(["file-a", "file-b"]);
  });

  it("isolates a per-tenant failure — one tenant's DB error does not block the others (defect 3)", async () => {
    mockConnectionManager.getKnownTenantIds.mockReturnValue([
      "tenant-broken",
      "tenant-ok",
    ]);

    const stuckOk = [
      {
        file_id: "file-ok",
        container_id: "container-ok",
        tenant_id: "tenant-ok",
        status: "processing",
        updated_at: new Date(),
      },
    ];

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mockConnectionManager.ensureSchema.mockImplementation(
      async (tenantId: string) => {
        if (tenantId === "tenant-broken") {
          throw new Error("connection refused");
        }
        return makeSqlTemplateFn(stuckOk);
      }
    );

    const result = await repository.findProcessingFilesOlderThan(10);

    expect(result).toHaveLength(1);
    expect(result[0]?.file_id).toBe("file-ok");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("does not throw when every tenant fails", async () => {
    mockConnectionManager.getKnownTenantIds.mockReturnValue([
      "tenant-a",
      "tenant-b",
    ]);
    mockConnectionManager.ensureSchema.mockRejectedValue(new Error("db down"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(repository.findProcessingFilesOlderThan(10)).resolves.toEqual(
      []
    );

    consoleErrorSpy.mockRestore();
  });
});

/**
 * Covers the SKB upload-endpoint gap fix: `createFile` inserts the
 * `skb_files` row the upload endpoint needs before publishing the
 * ingestion event the worker consumes.
 */
describe("SKBContainersRepository.createFile", () => {
  let mockConnectionManager: {
    getKnownTenantIds: ReturnType<typeof vi.fn>;
    ensureSchema: ReturnType<typeof vi.fn>;
  };
  let repository: SKBContainersRepository;

  beforeEach(() => {
    mockConnectionManager = {
      getKnownTenantIds: vi.fn().mockReturnValue([]),
      ensureSchema: vi.fn(),
    };
    repository = new SKBContainersRepository(mockConnectionManager as never);
  });

  it("inserts the skb_files row with status 'pending' and returns it", async () => {
    const inserted = {
      id: "row-1",
      container_id: "container-1",
      tenant_id: "tenant-123",
      file_id: "file-1",
      original_name: "sales.csv",
      categories: ["cat-1"],
      status: "pending",
    };
    const sqlFn = vi.fn().mockResolvedValue([inserted]);
    mockConnectionManager.ensureSchema.mockResolvedValue(sqlFn);

    const result = await repository.createFile("tenant-123", "container-1", {
      fileId: "file-1",
      originalName: "sales.csv",
      categories: ["cat-1"],
    });

    expect(mockConnectionManager.ensureSchema).toHaveBeenCalledWith(
      "tenant-123"
    );
    expect(result).toEqual(inserted);
  });

  it("defaults categories to an empty JSON array when none are provided", async () => {
    const inserted = {
      id: "row-2",
      container_id: "container-1",
      tenant_id: "tenant-123",
      file_id: "file-2",
      original_name: "sales.csv",
      categories: [],
      status: "pending",
    };
    const sqlFn = vi.fn().mockResolvedValue([inserted]);
    mockConnectionManager.ensureSchema.mockResolvedValue(sqlFn);

    const result = await repository.createFile("tenant-123", "container-1", {
      fileId: "file-2",
      originalName: "sales.csv",
      categories: [],
    });

    expect(result.categories).toEqual([]);
  });
});
