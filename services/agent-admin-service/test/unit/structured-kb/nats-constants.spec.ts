import { describe, it, expect } from "bun:test";

describe("SKB NATS Constants", () => {
  describe("AGENT_ADMIN_SKB_FILE_INGESTION", () => {
    it("should exist in @yoizen/shared/constants", async () => {
      const constants = await import("@yoizen/shared/constants");
      expect(constants.AGENT_ADMIN_SKB_FILE_INGESTION).toBeDefined();
    });

    it("should follow the canonical subject format", async () => {
      const { AGENT_ADMIN_SKB_FILE_INGESTION } = await import("@yoizen/shared/constants");
      const expectedPrefix = "evt.{tenant}.agent-admin-service.automation.platform.internal";
      expect(AGENT_ADMIN_SKB_FILE_INGESTION).toContain(expectedPrefix);
      expect(AGENT_ADMIN_SKB_FILE_INGESTION).toContain("skb_file_ingestion");
      expect(AGENT_ADMIN_SKB_FILE_INGESTION).toEndWith(".v1");
    });

    it("should have the exact subject format for SKB file ingestion events", async () => {
      const { AGENT_ADMIN_SKB_FILE_INGESTION } = await import("@yoizen/shared/constants");
      expect(AGENT_ADMIN_SKB_FILE_INGESTION).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1",
      );
    });

    it("should be re-exported from @yoizen/shared barrel", async () => {
      const shared = await import("@yoizen/shared");
      expect(shared.AGENT_ADMIN_SKB_FILE_INGESTION).toBeDefined();
    });

    it("should produce a valid tenant-specific subject via buildPlatformSubject", async () => {
      const { buildPlatformSubject, AGENT_ADMIN_SKB_FILE_INGESTION } = await import("@yoizen/shared");
      const tenantId = "acme-corp";
      const subject = buildPlatformSubject(AGENT_ADMIN_SKB_FILE_INGESTION, tenantId);
      expect(subject).toBe(
        "evt.acme-corp.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1",
      );
      expect(subject).not.toContain("{tenant}");
    });
  });

  describe("SKB file ingestion event payload schema", () => {
    it("should define an event payload type with required SKB fields", async () => {
      const mod = await import("../../src/modules/structured-kb/types/skb.types");
      expect(mod.SKBFileIngestionPayload).toBeDefined();
    });

    it("should include containerId, fileId, tenantId, and fileUrl in payload type", async () => {
      const mod = await import("../../src/modules/structured-kb/types/skb.types");
      const payload: mod.SKBFileIngestionPayload = {
        containerId: "container-1",
        fileId: "file-1",
        tenantId: "tenant-123",
        fileUrl: "https://example.com/file.csv",
        categories: ["cat-1"],
        sheetName: null,
      };
      expect(payload.containerId).toBe("container-1");
      expect(payload.fileId).toBe("file-1");
      expect(payload.tenantId).toBe("tenant-123");
      expect(payload.fileUrl).toBe("https://example.com/file.csv");
    });
  });
});
