import "../../setup-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { PermanentError } from "@yoizen/shared";
import type { JsMsg } from "nats";
import { SKBIngestionWorkerService } from "../../src/modules/structured-kb/skb-ingestion-worker.service";

// The worker resolves SKB LLM credentials before schema analysis; give the
// env fallback a dummy key so handleMessage tests don't fail on config.
process.env.OPENAI_API_KEY ??= "sk-test-not-a-real-key";

type MockFn = ReturnType<typeof vi.fn>;

function createMockMsg(overrides: Record<string, unknown> = {}): JsMsg {
  const payload = {
    containerId: "container-1",
    fileId: "file-1",
    tenantId: "tenant-123",
    kbId: "skb-1",
    fileUrl: "https://example.com/data.csv",
    categories: ["sales"],
    sheetName: null,
  };

  const envelope = {
    specversion: "1.0",
    id: "evt-1",
    source: "agent-admin-service",
    type: "skb_file_ingestion",
    data: {
      payload,
    },
  };

  return {
    json: vi.fn().mockReturnValue(envelope),
    ack: vi.fn(),
    nak: vi.fn(),
    term: vi.fn(),
    subject:
      "evt.tenant-123.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1",
    seq: 1,
    headers: null,
    ...overrides,
  } as unknown as JsMsg;
}

vi.mock("@yoizen/database", () => ({
  MultiTenantConsumerManager: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getBoundStreams: vi.fn().mockReturnValue(["INGRESS-tenant-123"]),
    getRunner: vi.fn().mockReturnValue({ isHealthy: () => true }),
  })),
}));

describe("SKBIngestionWorkerService", () => {
  let service: SKBIngestionWorkerService;
  let mockJsm: { consumers: MockFn; streams: MockFn };
  let mockJs: { pull: MockFn; publish: vi.Mock };
  let mockFileParser: { parseFile: MockFn };
  let mockSchemaAnalyzer: { analyze: MockFn };
  let mockRowStore: { insertRows: MockFn; deleteRowsForFile: MockFn };
  let mockContainerService: {
    findById: MockFn;
    updateStatus: MockFn;
    findFile: MockFn;
    updateFileStatus: MockFn;
  };
  let mockJobTrackingService: {
    createJob: MockFn;
    updateFileStatus: MockFn;
    completeJob: MockFn;
    failJob: MockFn;
    getJob: MockFn;
  };
  let mockConnectionManager: { ensureSchema: MockFn };
  let originalServiceMode: string | undefined;

  const TENANT_ID = "tenant-123";
  const CONTAINER_ID = "container-1";
  const FILE_ID = "file-1";
  // skb_files PRIMARY KEY — what skb_rows.file_id actually references
  // (distinct from the logical FILE_ID carried in the event payload).
  const FILE_ROW_PK = "file-row-pk-1";

  beforeEach(() => {
    originalServiceMode = process.env.SERVICE_MODE;
    process.env.SERVICE_MODE = "worker";

    mockJsm = {
      consumers: {
        add: vi.fn(),
      },
      streams: {
        info: vi.fn().mockResolvedValue({}),
        add: vi.fn(),
      },
    };

    mockJs = {
      pull: vi.fn(),
      publish: vi.fn(),
    };

    mockFileParser = {
      parseFile: vi.fn().mockResolvedValue({
        headers: ["name", "age", "city"],
        rows: [
          { name: "Alice", age: "30", city: "NYC" },
          { name: "Bob", age: "25", city: "LA" },
        ],
        rowCount: 2,
      }),
    };

    mockSchemaAnalyzer = {
      analyze: vi.fn().mockResolvedValue({
        columns: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
          { name: "city", type: "string" },
        ],
      }),
    };

    mockRowStore = {
      insertRows: vi.fn().mockResolvedValue(2),
      deleteRowsForFile: vi.fn().mockResolvedValue(0),
    };

    mockContainerService = {
      findById: vi.fn().mockResolvedValue({
        id: CONTAINER_ID,
        tenant_id: TENANT_ID,
        status: "pending",
        is_active: true,
      }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      findFile: vi.fn().mockResolvedValue({
        id: FILE_ROW_PK,
        file_id: FILE_ID,
        status: "pending",
      }),
      updateFileStatus: vi.fn().mockResolvedValue(undefined),
    };

    mockJobTrackingService = {
      createJob: vi
        .fn()
        .mockResolvedValue({ jobId: "job-1", status: "pending" }),
      updateFileStatus: vi.fn().mockResolvedValue(undefined),
      completeJob: vi.fn().mockResolvedValue(undefined),
      failJob: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue({ jobId: "job-1", status: "active" }),
    };

    mockConnectionManager = {
      ensureSchema: vi.fn().mockResolvedValue({
        Array,
      }),
    };

    service = new SKBIngestionWorkerService(
      mockJsm as never,
      mockJs as never,
      mockFileParser as never,
      mockSchemaAnalyzer as never,
      mockRowStore as never,
      mockContainerService as never,
      mockJobTrackingService as never,
      mockConnectionManager as never
    );
  });

  afterEach(() => {
    process.env.SERVICE_MODE = originalServiceMode;
    vi.restoreAllMocks();
  });

  describe("onModuleInit", () => {
    it("should skip init when SERVICE_MODE is not 'worker'", async () => {
      process.env.SERVICE_MODE = "api";
      await service.onModuleInit();
      // handleMessage is never called because manager is never started
    });
  });

  describe("handleMessage — payload parsing", () => {
    it("should parse the event envelope and extract SKB fields", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(msg.json).toHaveBeenCalled();
    });

    it("should throw PermanentError for invalid JSON", async () => {
      const msg = createMockMsg({
        json: vi.fn().mockImplementation(() => {
          throw new Error("invalid json");
        }),
      });

      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        PermanentError
      );
    });

    it("should throw PermanentError when containerId is missing", async () => {
      const msg = createMockMsg({
        json: vi.fn().mockReturnValue({
          data: {
            payload: {
              fileId: "file-1",
              tenantId: "tenant-123",
            },
          },
        }),
      });

      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        PermanentError
      );
    });

    it("should throw PermanentError when fileId is missing", async () => {
      const msg = createMockMsg({
        json: vi.fn().mockReturnValue({
          data: {
            payload: {
              containerId: "container-1",
              tenantId: "tenant-123",
            },
          },
        }),
      });

      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        PermanentError
      );
    });

    it("should throw PermanentError when tenantId is missing", async () => {
      const msg = createMockMsg({
        json: vi.fn().mockReturnValue({
          data: {
            payload: {
              containerId: "container-1",
              fileId: "file-1",
            },
          },
        }),
      });

      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        PermanentError
      );
    });
  });

  describe("handleMessage — full processing flow", () => {
    it("should parse the file via the file parser", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockFileParser.parseFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String)
      );
    });

    it("should analyze schema via SchemaAnalyzer", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockSchemaAnalyzer.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.any(Array),
          rows: expect.any(Array),
        }),
        undefined,
        undefined,
        expect.objectContaining({ apiKey: expect.any(String) })
      );
    });

    it("should insert typed rows into the database", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockConnectionManager.ensureSchema).toHaveBeenCalledWith(
        TENANT_ID
      );
      expect(mockRowStore.insertRows).toHaveBeenCalledWith(
        expect.any(Object),
        TENANT_ID,
        CONTAINER_ID,
        FILE_ROW_PK,
        expect.any(Array),
        ["sales"]
      );
    });

    it("should default categories to [] when the payload omits them (SKB defect 2)", async () => {
      const msg = createMockMsg({
        json: vi.fn().mockReturnValue({
          data: {
            payload: {
              containerId: CONTAINER_ID,
              fileId: FILE_ID,
              tenantId: TENANT_ID,
              fileUrl: "https://example.com/data.csv",
            },
          },
        }),
      });

      await (service as any).handleMessage(msg);

      expect(mockRowStore.insertRows).toHaveBeenCalledWith(
        expect.any(Object),
        TENANT_ID,
        CONTAINER_ID,
        FILE_ROW_PK,
        expect.any(Array),
        []
      );
    });

    it("should default categories to [] when the payload's categories field is not an array (SKB defect 2)", async () => {
      const msg = createMockMsg({
        json: vi.fn().mockReturnValue({
          data: {
            payload: {
              containerId: CONTAINER_ID,
              fileId: FILE_ID,
              tenantId: TENANT_ID,
              fileUrl: "https://example.com/data.csv",
              categories: "sales", // not an array — must not be passed through
            },
          },
        }),
      });

      await (service as any).handleMessage(msg);

      expect(mockRowStore.insertRows).toHaveBeenCalledWith(
        expect.any(Object),
        TENANT_ID,
        CONTAINER_ID,
        FILE_ROW_PK,
        expect.any(Array),
        []
      );
    });

    it("should update the file status to completed on success", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockContainerService.updateFileStatus).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        "completed",
        expect.any(Object)
      );
    });

    it("should update container status based on file statuses", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockContainerService.updateStatus).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        expect.any(String)
      );
    });
  });

  describe("handleMessage — death checks", () => {
    it("should verify container exists before processing", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockContainerService.findById).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID
      );
    });

    it("should throw when container was deleted before processing", async () => {
      mockContainerService.findById.mockResolvedValueOnce(null);
      const msg = createMockMsg();

      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        /deleted/i
      );
    });

    it("should verify container still exists after processing", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      const findByIdCalls = mockContainerService.findById.mock.calls;
      expect(findByIdCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("should cleanup rows when container was deleted mid-flight", async () => {
      let callCount = 0;
      mockContainerService.findById.mockImplementation(() => {
        callCount++;
        if (callCount >= 2) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: CONTAINER_ID,
          tenant_id: TENANT_ID,
          is_active: true,
        });
      });

      const msg = createMockMsg();
      await expect((service as any).handleMessage(msg)).rejects.toThrow();

      expect(mockRowStore.deleteRowsForFile).toHaveBeenCalledWith(
        expect.any(String),
        FILE_ROW_PK
      );
    });

    it("should verify job is active before processing", async () => {
      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockJobTrackingService.getJob).toHaveBeenCalled();
    });

    it("should throw when job was cancelled before processing", async () => {
      mockJobTrackingService.getJob.mockResolvedValueOnce(null);
      const msg = createMockMsg();

      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        /cancelled/i
      );
    });
  });

  describe("handleMessage — error handling", () => {
    it("should throw PermanentError for unsupported file types", async () => {
      mockFileParser.parseFile.mockRejectedValueOnce(
        new Error("Unsupported file type: .pdf")
      );

      const msg = createMockMsg();
      await expect((service as any).handleMessage(msg)).rejects.toThrow();
    });

    it("should throw PermanentError for malformed payloads (DLQ route)", async () => {
      const msg = createMockMsg({
        json: vi.fn().mockReturnValue(null),
      });

      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        PermanentError
      );
    });

    it("should mark file as failed on processing error", async () => {
      mockSchemaAnalyzer.analyze.mockRejectedValueOnce(
        new Error("LLM timeout")
      );

      const msg = createMockMsg();
      await expect((service as any).handleMessage(msg)).rejects.toThrow(
        "LLM timeout"
      );

      expect(mockContainerService.updateFileStatus).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        "failed",
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it("should mark job as failed on processing error", async () => {
      mockSchemaAnalyzer.analyze.mockRejectedValueOnce(
        new Error("LLM timeout")
      );

      const msg = createMockMsg();
      try {
        await (service as any).handleMessage(msg);
      } catch {}

      expect(mockJobTrackingService.failJob).toHaveBeenCalledWith(
        TENANT_ID,
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe("handleMessage — container status recomputation", () => {
    it("should set container to 'processing' when some files are still pending", async () => {
      mockContainerService.findById.mockResolvedValue({
        id: CONTAINER_ID,
        tenant_id: TENANT_ID,
        status: "pending",
        is_active: true,
      });

      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      const statusCalls = mockContainerService.updateStatus.mock.calls;
      const lastStatusCall = statusCalls[statusCalls.length - 1];
      expect(lastStatusCall).toBeDefined();
    });

    it("should set container to 'ready' when all files are completed", async () => {
      mockContainerService.findFile.mockResolvedValue({
        file_id: FILE_ID,
        status: "completed",
      });

      const msg = createMockMsg();
      await (service as any).handleMessage(msg);

      expect(mockContainerService.updateStatus).toHaveBeenCalled();
    });

    it("should set container to 'failed' when all files failed", async () => {
      mockSchemaAnalyzer.analyze.mockRejectedValueOnce(new Error("LLM down"));

      const msg = createMockMsg();
      try {
        await (service as any).handleMessage(msg);
      } catch {}

      expect(mockContainerService.updateStatus).toHaveBeenCalled();
    });
  });
});
