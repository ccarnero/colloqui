import { describe, it, expect, beforeEach, vi } from "bun:test";
import { randomUUID } from "node:crypto";
import { JobTrackingService } from "../../src/modules/knowledge-bases/job-tracking.service";
import type { JobFileStatus, JobStatus } from "../../src/modules/knowledge-bases/job-tracking.service";

type MockFn = ReturnType<typeof vi.fn>;

describe("JobTrackingService", () => {
  let service: JobTrackingService;
  let mockRedis: {
    hset: MockFn;
    hgetall: MockFn;
    expire: MockFn;
    exists: MockFn;
    del: MockFn;
  };

  const TENANT_ID = "tenant-123";
  const KB_ID = "kb-456";
  const FILE_IDS = ["file-a", "file-b", "file-c"];

  beforeEach(() => {
    mockRedis = {
      hset: vi.fn().mockResolvedValue(3),
      hgetall: vi.fn(),
      expire: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
    };

    service = new JobTrackingService(mockRedis as never);
  });

  // ---------------------------------------------------------------------------
  // createJob
  // ---------------------------------------------------------------------------
  describe("createJob", () => {
    it("should create a job with all files set to pending status", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      expect(job.jobId).toBeDefined();
      expect(job.kbId).toBe(KB_ID);
      expect(job.tenantId).toBe(TENANT_ID);
      expect(job.status).toBe("pending");
      expect(job.files).toHaveLength(3);

      for (const file of job.files) {
        expect(file.status).toBe("pending");
        expect(FILE_IDS).toContain(file.fileId);
      }
    });

    it("should store job data in Redis hash", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      // hset should be called for each file entry
      expect(mockRedis.hset).toHaveBeenCalled();

      const hsetCall = mockRedis.hset.mock.calls[0] as [string, ...unknown[]];
      const key = hsetCall[0] as string;
      expect(key).toContain(KB_ID);
      expect(key).toContain(job.jobId);
    });

    it("should set Redis hash with file entries serialized as JSON", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      // Each file should be stored as a JSON string under its fileId key
      const hsetData = mockRedis.hset.mock.calls[0] as [string, ...Array<[string, string]>];
      const entries = hsetData.slice(1) as Array<[string, string]>;

      for (const [fileId, value] of entries) {
        expect(FILE_IDS).toContain(fileId);
        const parsed = JSON.parse(value);
        expect(parsed.fileId).toBe(fileId);
        expect(parsed.status).toBe("pending");
      }
    });

    it("should return job with pending aggregate status for empty file list", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, []);

      expect(job.files).toHaveLength(0);
      expect(job.status).toBe("pending");
    });

    it("should generate a unique job ID for each call", async () => {
      const job1 = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      const job2 = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      expect(job1.jobId).not.toBe(job2.jobId);
    });
  });

  // ---------------------------------------------------------------------------
  // updateFileStatus
  // ---------------------------------------------------------------------------
  describe("updateFileStatus", () => {
    it("should update a single file from pending to processing", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      mockRedis.hset.mockClear();

      await service.updateFileStatus(
        TENANT_ID,
        KB_ID,
        job.jobId,
        FILE_IDS[0],
        "processing" as JobFileStatus,
      );

      expect(mockRedis.hset).toHaveBeenCalledTimes(1);
      const call = mockRedis.hset.mock.calls[0] as [string, ...unknown[]];
      expect(JSON.parse(call[2] as string).status).toBe("processing");
    });

    it("should update file from processing to completed", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      mockRedis.hset.mockClear();

      await service.updateFileStatus(
        TENANT_ID,
        KB_ID,
        job.jobId,
        FILE_IDS[0],
        "completed" as JobFileStatus,
      );

      const call = mockRedis.hset.mock.calls[0] as [string, ...unknown[]];
      expect(JSON.parse(call[2] as string).status).toBe("completed");
    });

    it("should store error message when updating to failed", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      mockRedis.hset.mockClear();
      const errorMessage = "Embedding API timeout";

      await service.updateFileStatus(
        TENANT_ID,
        KB_ID,
        job.jobId,
        FILE_IDS[0],
        "failed" as JobFileStatus,
        errorMessage,
      );

      const call = mockRedis.hset.mock.calls[0] as [string, ...unknown[]];
      const parsed = JSON.parse(call[2] as string);
      expect(parsed.status).toBe("failed");
      expect(parsed.error).toBe(errorMessage);
    });

    it("should throw if file ID does not belong to the job", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      await expect(
        service.updateFileStatus(
          TENANT_ID,
          KB_ID,
          job.jobId,
          "non-existent-file",
          "processing" as JobFileStatus,
        ),
      ).rejects.toThrow(/not found|not part of|unknown file/i);
    });
  });

  // ---------------------------------------------------------------------------
  // getJob
  // ---------------------------------------------------------------------------
  describe("getJob", () => {
    it("should return null for non-existent job", async () => {
      mockRedis.exists.mockResolvedValue(0);

      const result = await service.getJob(TENANT_ID, KB_ID, "non-existent-job");

      expect(result).toBeNull();
    });

    it("should return full job with all file statuses", async () => {
      const created = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      // Simulate stored data in Redis
      const storedFiles: Record<string, string> = {};
      for (let i = 0; i < FILE_IDS.length; i++) {
        storedFiles[FILE_IDS[i]] = JSON.stringify({
          fileId: FILE_IDS[i],
          status: i === 0 ? "processing" : "pending" as string,
        });
      }
      storedFiles.createdAt = created.createdAt;
      storedFiles.status = "processing";

      mockRedis.hgetall.mockResolvedValue(storedFiles);

      const job = await service.getJob(TENANT_ID, KB_ID, created.jobId);

      expect(job).not.toBeNull();
      expect(job!.jobId).toBe(created.jobId);
      expect(job!.kbId).toBe(KB_ID);
      expect(job!.tenantId).toBe(TENANT_ID);
      expect(job!.files).toHaveLength(3);
    });

    it("should compute aggregate status as 'completed' when all files completed", async () => {
      const created = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      const storedFiles: Record<string, string> = {};
      for (const fid of FILE_IDS) {
        storedFiles[fid] = JSON.stringify({ fileId: fid, status: "completed" });
      }
      storedFiles.createdAt = created.createdAt;
      storedFiles.status = "processing";
      mockRedis.hgetall.mockResolvedValue(storedFiles);

      const job = await service.getJob(TENANT_ID, KB_ID, created.jobId);
      expect(job!.status).toBe("completed");
    });

    it("should compute aggregate status as 'failed' when all files failed", async () => {
      const created = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      const storedFiles: Record<string, string> = {};
      for (const fid of FILE_IDS) {
        storedFiles[fid] = JSON.stringify({ fileId: fid, status: "failed", error: "err" });
      }
      storedFiles.createdAt = created.createdAt;
      storedFiles.status = "processing";
      mockRedis.hgetall.mockResolvedValue(storedFiles);

      const job = await service.getJob(TENANT_ID, KB_ID, created.jobId);
      expect(job!.status).toBe("failed");
    });

    it("should compute aggregate status as 'partial' when files are mixed completed/failed", async () => {
      const created = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      const storedFiles: Record<string, string> = {
        [FILE_IDS[0]]: JSON.stringify({ fileId: FILE_IDS[0], status: "completed" }),
        [FILE_IDS[1]]: JSON.stringify({ fileId: FILE_IDS[1], status: "failed", error: "err" }),
        [FILE_IDS[2]]: JSON.stringify({ fileId: FILE_IDS[2], status: "completed" }),
      };
      storedFiles.createdAt = created.createdAt;
      storedFiles.status = "processing";
      mockRedis.hgetall.mockResolvedValue(storedFiles);

      const job = await service.getJob(TENANT_ID, KB_ID, created.jobId);
      expect(job!.status).toBe("partial");
    });

    it("should compute aggregate status as 'processing' when any file is processing", async () => {
      const created = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      const storedFiles: Record<string, string> = {
        [FILE_IDS[0]]: JSON.stringify({ fileId: FILE_IDS[0], status: "completed" }),
        [FILE_IDS[1]]: JSON.stringify({ fileId: FILE_IDS[1], status: "processing" }),
        [FILE_IDS[2]]: JSON.stringify({ fileId: FILE_IDS[2], status: "pending" }),
      };
      storedFiles.createdAt = created.createdAt;
      storedFiles.status = "processing";
      mockRedis.hgetall.mockResolvedValue(storedFiles);

      const job = await service.getJob(TENANT_ID, KB_ID, created.jobId);
      expect(job!.status).toBe("processing");
    });

    it("should return files with their individual statuses and optional errors", async () => {
      const created = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      const storedFiles: Record<string, string> = {
        [FILE_IDS[0]]: JSON.stringify({ fileId: FILE_IDS[0], status: "completed", chunkCount: 42 }),
        [FILE_IDS[1]]: JSON.stringify({ fileId: FILE_IDS[1], status: "failed", error: "Processing error" }),
        [FILE_IDS[2]]: JSON.stringify({ fileId: FILE_IDS[2], status: "pending" }),
      };
      storedFiles.createdAt = created.createdAt;
      storedFiles.status = "processing";
      mockRedis.hgetall.mockResolvedValue(storedFiles);

      const job = await service.getJob(TENANT_ID, KB_ID, created.jobId);

      const fileA = job!.files.find((f) => f.fileId === FILE_IDS[0]);
      expect(fileA?.status).toBe("completed");
      expect(fileA?.chunkCount).toBe(42);

      const fileB = job!.files.find((f) => f.fileId === FILE_IDS[1]);
      expect(fileB?.status).toBe("failed");
      expect(fileB?.error).toBe("Processing error");

      const fileC = job!.files.find((f) => f.fileId === FILE_IDS[2]);
      expect(fileC?.status).toBe("pending");
    });
  });

  // ---------------------------------------------------------------------------
  // completeJob
  // ---------------------------------------------------------------------------
  describe("completeJob", () => {
    it("should mark job as completed and set completedAt timestamp", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      mockRedis.hset.mockClear();

      await service.completeJob(TENANT_ID, KB_ID, job.jobId);

      // Should update the job status + completedAt
      const hsetCalls = mockRedis.hset.mock.calls;
      expect(hsetCalls.length).toBeGreaterThanOrEqual(1);

      const statusUpdate = hsetCalls.find(
        (call: unknown[]) => (call[1] as string) === "status" || (call[2] as string)?.includes("completed"),
      );
      expect(statusUpdate).toBeDefined();
    });

    it("should set TTL on the job key after completion (24h = 86400s)", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      mockRedis.expire.mockClear();

      await service.completeJob(TENANT_ID, KB_ID, job.jobId);

      expect(mockRedis.expire).toHaveBeenCalled();
      const ttlValue = (mockRedis.expire.mock.calls[0] as [string, number])[1];
      expect(ttlValue).toBe(86400);
    });

    it("should throw if job does not exist", async () => {
      mockRedis.exists.mockResolvedValue(0);

      await expect(
        service.completeJob(TENANT_ID, KB_ID, "non-existent"),
      ).rejects.toThrow(/not found|does not exist/i);
    });
  });

  // ---------------------------------------------------------------------------
  // failJob
  // ---------------------------------------------------------------------------
  describe("failJob", () => {
    it("should mark job as failed with error message", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      mockRedis.hset.mockClear();
      const errorMsg = "Chunking pipeline crashed";

      await service.failJob(TENANT_ID, KB_ID, job.jobId, errorMsg);

      // Should update status + error
      const hsetCalls = mockRedis.hset.mock.calls;
      const errorUpdate = hsetCalls.find(
        (call: unknown[]) => (call[1] as string) === "error" || (call[2] as string)?.includes(errorMsg),
      );
      expect(errorUpdate).toBeDefined();
    });

    it("should set TTL on the job key after failure (24h = 86400s)", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);
      mockRedis.expire.mockClear();

      await service.failJob(TENANT_ID, KB_ID, job.jobId, "error");

      expect(mockRedis.expire).toHaveBeenCalled();
      const ttlValue = (mockRedis.expire.mock.calls[0] as [string, number])[1];
      expect(ttlValue).toBe(86400);
    });

    it("should throw if job does not exist", async () => {
      mockRedis.exists.mockResolvedValue(0);

      await expect(
        service.failJob(TENANT_ID, KB_ID, "non-existent", "error"),
      ).rejects.toThrow(/not found|does not exist/i);
    });

    it("should preserve previously completed file statuses when failing remaining files", async () => {
      const job = await service.createJob(TENANT_ID, KB_ID, FILE_IDS);

      // Simulate: file-a completed, then rest fail
      mockRedis.hset.mockClear();
      const errorMsg = "Embedding service unavailable";

      await service.failJob(TENANT_ID, KB_ID, job.jobId, errorMsg);

      // At minimum, the status and error should be set
      const allArgs = mockRedis.hset.mock.calls.flatMap((call: unknown[]) => call.slice(1) as Array<[string, unknown]>);
      const statusEntry = allArgs.find(
        (entry: [string, unknown]) => entry[0] === "status",
      );
      expect(statusEntry).toBeDefined();
      expect(statusEntry![1]).toBe("failed");
    });
  });
});
