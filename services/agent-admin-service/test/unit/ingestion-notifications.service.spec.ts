import { describe, it, expect, beforeEach, vi } from "bun:test";
import { IngestionNotificationsService } from "../../src/modules/knowledge-bases/ingestion-notifications.service";

type MockFn = ReturnType<typeof vi.fn>;

describe("IngestionNotificationsService", () => {
  let service: IngestionNotificationsService;
  let mockJs: {
    publish: MockFn;
  };

  const TENANT_ID = "tenant-123";
  const KB_ID = "kb-456";
  const JOB_ID = "job-789";

  const FILE_RESULTS_COMPLETED = [
    { fileId: "file-a", status: "completed", chunkCount: 42, charCount: 1500 },
    { fileId: "file-b", status: "completed", chunkCount: 18, charCount: 720 },
  ];

  const FILE_RESULTS_PARTIAL = [
    { fileId: "file-a", status: "completed", chunkCount: 42 },
    { fileId: "file-b", status: "failed", error: "Embedding API timeout" },
  ];

  beforeEach(() => {
    mockJs = {
      publish: vi.fn().mockResolvedValue({
        seq: 1,
        duplicate: false,
        stream: "INGESTION-EVENTS",
      }),
    };

    service = new IngestionNotificationsService(mockJs as never);
  });

  // ---------------------------------------------------------------------------
  // publishCompleted
  // ---------------------------------------------------------------------------
  describe("publishCompleted", () => {
    it("should publish a NATS JetStream event on completion", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      expect(mockJs.publish).toHaveBeenCalledTimes(1);
    });

    it("should publish to a subject that includes 'ingestion' and 'completed'", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      const subject = (mockJs.publish.mock.calls[0] as [string, ...unknown[]])[0];
      expect(subject).toContain(TENANT_ID);
      expect(subject).toMatch(/ingest|ingestion/i);
    });

    it("should include resource_type, tenant_id, kb_id, job_id in payload", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.resource_type).toBeDefined();
      expect(payload.tenant_id).toBe(TENANT_ID);
      expect(payload.kb_id).toBe(KB_ID);
      expect(payload.job_id).toBe(JOB_ID);
    });

    it("should include status 'completed' in the event payload", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );
      expect(payload.status).toBe("completed");
    });

    it("should include all file results with per-file status", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.files).toHaveLength(2);
      expect(payload.files[0].fileId).toBe("file-a");
      expect(payload.files[0].status).toBe("completed");
      expect(payload.files[1].fileId).toBe("file-b");
    });

    it("should include an ISO 8601 completed_at timestamp", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.completed_at).toBeDefined();
      expect(() => new Date(payload.completed_at)).not.toThrow();
      expect(new Date(payload.completed_at).toISOString()).toBe(
        payload.completed_at,
      );
    });

    it("should not include an error field in successful completion", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.error).toBeUndefined();
    });

    it("should work with partial results (some files failed)", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_PARTIAL,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.files).toHaveLength(2);
      const failedFile = payload.files.find(
        (f: Record<string, unknown>) => f.fileId === "file-b",
      );
      expect(failedFile.status).toBe("failed");
      expect(failedFile.error).toBe("Embedding API timeout");
    });

    it("should publish stringified JSON as the message body", async () => {
      await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      const call = mockJs.publish.mock.calls[0] as [string, string];
      expect(typeof call[1]).toBe("string");
      // Should be parseable JSON
      expect(() => JSON.parse(call[1])).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // publishFailed
  // ---------------------------------------------------------------------------
  describe("publishFailed", () => {
    const FAILURE_ERROR = "Chunking pipeline crashed: out of memory";

    it("should publish a NATS JetStream event on failure", async () => {
      await service.publishFailed(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FAILURE_ERROR,
      );

      expect(mockJs.publish).toHaveBeenCalledTimes(1);
    });

    it("should include status 'failed' in the event payload", async () => {
      await service.publishFailed(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FAILURE_ERROR,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );
      expect(payload.status).toBe("failed");
    });

    it("should include the error message in the event payload", async () => {
      await service.publishFailed(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FAILURE_ERROR,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );
      expect(payload.error).toBe(FAILURE_ERROR);
    });

    it("should include tenant_id, kb_id, and job_id in failure event", async () => {
      await service.publishFailed(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FAILURE_ERROR,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.tenant_id).toBe(TENANT_ID);
      expect(payload.kb_id).toBe(KB_ID);
      expect(payload.job_id).toBe(JOB_ID);
    });

    it("should include an ISO 8601 completed_at timestamp in failure event", async () => {
      await service.publishFailed(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FAILURE_ERROR,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.completed_at).toBeDefined();
      expect(() => new Date(payload.completed_at)).not.toThrow();
    });

    it("should include resource_type in failure event", async () => {
      await service.publishFailed(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FAILURE_ERROR,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.resource_type).toBeDefined();
    });

    it("should include empty files array in failure event", async () => {
      await service.publishFailed(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FAILURE_ERROR,
      );

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );

      expect(payload.files).toBeDefined();
      expect(Array.isArray(payload.files)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Best-effort (fire-and-forget) — never throws
  // ---------------------------------------------------------------------------
  describe("best-effort (fire-and-forget)", () => {
    it("should NOT throw when JetStream publish fails with an error", async () => {
      mockJs.publish.mockRejectedValue(new Error("NATS connection lost"));

      await expect(
        service.publishCompleted(TENANT_ID, KB_ID, JOB_ID, FILE_RESULTS_COMPLETED),
      ).resolves.toBeUndefined();
    });

    it("should NOT throw when publishFailed encounters a JetStream error", async () => {
      mockJs.publish.mockRejectedValue(new Error("Stream not found"));

      await expect(
        service.publishFailed(TENANT_ID, KB_ID, JOB_ID, "error"),
      ).resolves.toBeUndefined();
    });

    it("should NOT throw when JetStream publish throws a non-Error", async () => {
      mockJs.publish.mockRejectedValue("string error");

      await expect(
        service.publishCompleted(TENANT_ID, KB_ID, JOB_ID, FILE_RESULTS_COMPLETED),
      ).resolves.toBeUndefined();
    });

    it("should NOT throw when JetStream publish returns null", async () => {
      mockJs.publish.mockResolvedValue(null);

      await expect(
        service.publishCompleted(TENANT_ID, KB_ID, JOB_ID, FILE_RESULTS_COMPLETED),
      ).resolves.toBeUndefined();
    });

    it("should return void (not a PubAck) on successful publish", async () => {
      const result = await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      expect(result).toBeUndefined();
    });

    it("should return void on failed publish (not throw)", async () => {
      mockJs.publish.mockRejectedValue(new Error("timeout"));

      const result = await service.publishCompleted(
        TENANT_ID,
        KB_ID,
        JOB_ID,
        FILE_RESULTS_COMPLETED,
      );

      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    it("should handle empty file results array", async () => {
      await expect(
        service.publishCompleted(TENANT_ID, KB_ID, JOB_ID, []),
      ).resolves.toBeUndefined();

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );
      expect(payload.files).toEqual([]);
    });

    it("should handle very long error messages", async () => {
      const longError = "A".repeat(10000);

      await expect(
        service.publishFailed(TENANT_ID, KB_ID, JOB_ID, longError),
      ).resolves.toBeUndefined();
    });

    it("should handle special characters in error messages", async () => {
      const specialError = "Error: \"unexpected token\" & 'quote' <tag>";

      await expect(
        service.publishFailed(TENANT_ID, KB_ID, JOB_ID, specialError),
      ).resolves.toBeUndefined();

      const payload = JSON.parse(
        (mockJs.publish.mock.calls[0] as [string, string])[1],
      );
      expect(payload.error).toBe(specialError);
    });
  });
});
