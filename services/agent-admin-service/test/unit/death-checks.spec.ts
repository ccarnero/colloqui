import { describe, it, expect, vi } from "bun:test";
import { verifyKbExists, verifyJobActive } from "../../src/modules/knowledge-bases/death-checks";

type MockFn = ReturnType<typeof vi.fn>;

describe("DeathChecks", () => {
  const TENANT_ID = "tenant-123";
  const KB_ID = "kb-456";
  const JOB_ID = "job-789";

  // ---------------------------------------------------------------------------
  // verifyKbExists
  // ---------------------------------------------------------------------------
  describe("verifyKbExists", () => {
    it("should return void when knowledge base exists", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(true);

      await expect(
        verifyKbExists(checkKbExists, TENANT_ID, KB_ID),
      ).resolves.toBeUndefined();
    });

    it("should throw an error when knowledge base was deleted", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(false);

      await expect(
        verifyKbExists(checkKbExists, TENANT_ID, KB_ID),
      ).rejects.toThrow();
    });

    it("should include the KB ID in the error message for deleted KBs", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(false);

      await expect(
        verifyKbExists(checkKbExists, TENANT_ID, KB_ID),
      ).rejects.toThrow(new RegExp(KB_ID));
    });

    it("should be callable before a heavy operation to verify state", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(true);

      // Simulate death check before operation
      await verifyKbExists(checkKbExists, TENANT_ID, KB_ID);
      expect(checkKbExists).toHaveBeenCalledWith(TENANT_ID, KB_ID);
    });

    it("should be callable after a heavy operation to detect mid-flight deletion", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(true);

      // Simulate death check after operation
      await verifyKbExists(checkKbExists, TENANT_ID, KB_ID);
      expect(checkKbExists).toHaveBeenCalledTimes(1);
    });

    it("should propagate errors from the check function", async () => {
      const dbError = new Error("Database connection lost");
      const checkKbExists: MockFn = vi.fn().mockRejectedValue(dbError);

      await expect(
        verifyKbExists(checkKbExists, TENANT_ID, KB_ID),
      ).rejects.toThrow("Database connection lost");
    });

    it("should throw with descriptive message for deleted KB (regression guard)", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(false);

      try {
        await verifyKbExists(checkKbExists, TENANT_ID, KB_ID);
        // Force failure if no error thrown
        expect("no error").toBe("should have thrown");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message.toLowerCase()).toContain("deleted");
        expect(message).toContain(KB_ID);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // verifyJobActive
  // ---------------------------------------------------------------------------
  describe("verifyJobActive", () => {
    it("should return void when job is active", async () => {
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(true);

      await expect(
        verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID),
      ).resolves.toBeUndefined();
    });

    it("should throw an error when job was cancelled", async () => {
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(false);

      await expect(
        verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID),
      ).rejects.toThrow();
    });

    it("should include the job ID in the error message for cancelled jobs", async () => {
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(false);

      await expect(
        verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID),
      ).rejects.toThrow(new RegExp(JOB_ID));
    });

    it("should be callable both before and during ingestion", async () => {
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(true);

      // Before ingest
      await verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID);
      // After some files processed
      await verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID);
      // Before publish
      await verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID);

      expect(checkJobActive).toHaveBeenCalledTimes(3);
    });

    it("should propagate errors from the check function", async () => {
      const dbError = new Error("Redis connection timeout");
      const checkJobActive: MockFn = vi.fn().mockRejectedValue(dbError);

      await expect(
        verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID),
      ).rejects.toThrow("Redis connection timeout");
    });

    it("should throw with descriptive message for cancelled job (regression guard)", async () => {
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(false);

      try {
        await verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID);
        expect("no error").toBe("should have thrown");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message.toLowerCase()).toContain("cancelled");
        expect(message).toContain(JOB_ID);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Combined — both checks can be used in sequence
  // ---------------------------------------------------------------------------
  describe("combined death checks", () => {
    it("should pass both checks when KB and job are valid", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(true);
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(true);

      await expect(
        verifyKbExists(checkKbExists, TENANT_ID, KB_ID),
      ).resolves.toBeUndefined();
      await expect(
        verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID),
      ).resolves.toBeUndefined();
    });

    it("should fail on KB check even if job is active", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(false);
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(true);

      await expect(
        verifyKbExists(checkKbExists, TENANT_ID, KB_ID),
      ).rejects.toThrow();
    });

    it("should fail on job check even if KB exists", async () => {
      const checkKbExists: MockFn = vi.fn().mockResolvedValue(true);
      const checkJobActive: MockFn = vi.fn().mockResolvedValue(false);

      await expect(
        verifyJobActive(checkJobActive, TENANT_ID, KB_ID, JOB_ID),
      ).rejects.toThrow();
    });
  });
});
