import "../../setup-env";
import { describe, it, expect, beforeEach, vi, afterEach } from "bun:test";
import { SKBIngestionWatchdogService } from "../../src/modules/structured-kb/skb-ingestion-watchdog.service";

type MockFn = ReturnType<typeof vi.fn>;

describe("SKBIngestionWatchdogService", () => {
  let service: SKBIngestionWatchdogService;
  let mockContainerService: {
    findAllContainersWithProcessingFiles: MockFn;
    updateFileStatus: MockFn;
    updateStatus: MockFn;
  };
  let originalServiceMode: string | undefined;
  let originalInterval: typeof globalThis.setInterval;

  beforeEach(() => {
    originalServiceMode = process.env.SERVICE_MODE;
    process.env.SERVICE_MODE = "worker";
    originalInterval = globalThis.setInterval;
  });

  afterEach(() => {
    process.env.SERVICE_MODE = originalServiceMode;
    vi.restoreAllMocks();
  });

  function createService(options?: { checkIntervalMs?: number }) {
    mockContainerService = {
      findAllContainersWithProcessingFiles: vi.fn().mockResolvedValue([]),
      updateFileStatus: vi.fn().mockResolvedValue(undefined),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };

    service = new SKBIngestionWatchdogService(
      mockContainerService as never,
      options?.checkIntervalMs,
    );

    return service;
  }

  describe("onModuleInit", () => {
    it("should start a periodic check when SERVICE_MODE is worker", async () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      createService();

      await service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Number),
      );

      service.onModuleDestroy();
      setIntervalSpy.mockRestore();
    });

    it("should skip init when SERVICE_MODE is not worker", async () => {
      process.env.SERVICE_MODE = "api";
      createService();

      await service.onModuleInit();

      expect(mockContainerService.findAllContainersWithProcessingFiles).not.toHaveBeenCalled();
    });

    it("should run the first check immediately on init", async () => {
      createService();
      await service.onModuleInit();

      expect(mockContainerService.findAllContainersWithProcessingFiles).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
    });

    it("should use a configurable check interval", async () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      createService({ checkIntervalMs: 30_000 });

      await service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        30_000,
      );

      service.onModuleDestroy();
      setIntervalSpy.mockRestore();
    });

    it("should use a default check interval of 5 minutes when not configured", async () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      createService();

      await service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 1000,
      );

      service.onModuleDestroy();
      setIntervalSpy.mockRestore();
    });
  });

  describe("onModuleDestroy", () => {
    it("should clear the interval timer", async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      createService();

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it("should be safe to call when not started", () => {
      createService();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe("stuck file detection", () => {
    it("should find files stuck in processing status beyond the threshold", async () => {
      createService();

      const stuckFile = {
        containerId: "container-1",
        tenantId: "tenant-123",
        fileId: "file-stuck",
        status: "processing",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [stuckFile],
      );

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(mockContainerService.findAllContainersWithProcessingFiles).toHaveBeenCalledWith(
        expect.any(Number),
      );
    });

    it("should use the default stuck threshold of 10 minutes", async () => {
      createService();

      await service.onModuleInit();
      service.onModuleDestroy();

      const call = mockContainerService.findAllContainersWithProcessingFiles.mock.calls[0];
      expect(call[0]).toBe(10);
    });

    it("should reset stuck files to failed status", async () => {
      createService();

      const stuckFile = {
        containerId: "container-1",
        tenantId: "tenant-123",
        fileId: "file-stuck",
        status: "processing",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [stuckFile],
      );

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(mockContainerService.updateFileStatus).toHaveBeenCalledWith(
        "tenant-123",
        "container-1",
        "file-stuck",
        "failed",
        expect.objectContaining({
          error: expect.stringContaining("stuck"),
        }),
      );
    });

    it("should include a descriptive error message when resetting stuck files", async () => {
      createService();

      const stuckFile = {
        containerId: "container-1",
        tenantId: "tenant-123",
        fileId: "file-stuck",
        status: "processing",
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
      };

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [stuckFile],
      );

      await service.onModuleInit();
      service.onModuleDestroy();

      const errorArg = mockContainerService.updateFileStatus.mock.calls[0][4];
      expect(errorArg.error.toLowerCase()).toContain("stuck");
      expect(errorArg.error.toLowerCase()).toContain("processing");
    });

    it("should recompute container status after resetting stuck files", async () => {
      createService();

      const stuckFile = {
        containerId: "container-1",
        tenantId: "tenant-123",
        fileId: "file-stuck",
        status: "processing",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [stuckFile],
      );

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(mockContainerService.updateStatus).toHaveBeenCalledWith(
        "tenant-123",
        "container-1",
      );
    });

    it("should handle multiple stuck files across containers", async () => {
      createService();

      const stuckFiles = [
        {
          containerId: "container-1",
          tenantId: "tenant-123",
          fileId: "file-a",
          status: "processing",
          updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        },
        {
          containerId: "container-2",
          tenantId: "tenant-456",
          fileId: "file-b",
          status: "processing",
          updatedAt: new Date(Date.now() - 25 * 60 * 1000),
        },
      ];

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        stuckFiles,
      );

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(mockContainerService.updateFileStatus).toHaveBeenCalledTimes(2);
      expect(mockContainerService.updateStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe("graceful error handling", () => {
    it("should handle empty tenant list without error", async () => {
      createService();

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [],
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(mockContainerService.updateFileStatus).not.toHaveBeenCalled();
      service.onModuleDestroy();
    });

    it("should handle DB error gracefully during check and continue", async () => {
      createService();

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockContainerService.findAllContainersWithProcessingFiles.mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      service.onModuleDestroy();
      consoleSpy.mockRestore();
    });

    it("should handle DB error when updating file status", async () => {
      createService();

      const stuckFile = {
        containerId: "container-1",
        tenantId: "tenant-123",
        fileId: "file-stuck",
        status: "processing",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [stuckFile],
      );
      mockContainerService.updateFileStatus.mockRejectedValueOnce(
        new Error("Write timeout"),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      service.onModuleDestroy();
    });

    it("should handle DB error when recomputing container status", async () => {
      createService();

      const stuckFile = {
        containerId: "container-1",
        tenantId: "tenant-123",
        fileId: "file-stuck",
        status: "processing",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [stuckFile],
      );
      mockContainerService.updateStatus.mockRejectedValueOnce(
        new Error("Redis timeout"),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      service.onModuleDestroy();
    });

    it("should not throw when no stuck files are found (happy path)", async () => {
      createService();

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [],
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      service.onModuleDestroy();
    });
  });

  describe("logging", () => {
    it("should log a warning for each reset stuck file", async () => {
      createService();

      const stuckFile = {
        containerId: "container-1",
        tenantId: "tenant-123",
        fileId: "file-stuck",
        status: "processing",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      mockContainerService.findAllContainersWithProcessingFiles.mockResolvedValueOnce(
        [stuckFile],
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("stuck"),
      );

      warnSpy.mockRestore();
    });

    it("should log start with interval and threshold info", async () => {
      createService();

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("watchdog"),
      );

      logSpy.mockRestore();
    });
  });
});
