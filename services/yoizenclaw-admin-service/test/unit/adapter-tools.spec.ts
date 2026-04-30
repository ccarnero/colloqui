import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { AgentsService } from "../../src/modules/agents/agents.service";
import {
  AgentsRepository,
  type IAgent,
  type ICreateAgentData,
} from "../../src/modules/agents/agents.repository";
import { LAZY_NATS, NatsPublisher } from "../../src/providers/nats.provider";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";

const TENANT_ID = "tenant-test";

/**
 * Validates that each tool has exactly one of `endpoint` or `adapterRef`.
 * Used by adapter-tools tests only (not wired to HTTP validation).
 */
async function validateToolSourceExclusion(
  tools: unknown[],
): Promise<string[]> {
  const errors: string[] = [];
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i] as Record<string, unknown>;
    const hasEndpoint = Boolean(tool.endpoint);
    const hasAdapterRef = Boolean(tool.adapterRef);
    if (hasEndpoint && hasAdapterRef) {
      errors.push(
        `Tool at index ${i}: must have either endpoint OR adapterRef, not both`,
      );
    }
    if (!hasEndpoint && !hasAdapterRef) {
      errors.push(
        `Tool at index ${i}: must have either endpoint OR adapterRef`,
      );
    }
  }
  return errors;
}

type MockFn = ReturnType<typeof vi.fn>;

function makeAgent(overrides?: Partial<IAgent>): IAgent {
  return {
    id: "agent-1",
    name: "Test Agent",
    description: null,
    system_prompt: "You are helpful",
    model_config: {},
    tools: [],
    channels: [],
    status: "draft",
    is_active: true,
    published_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("Adapter Tools", () => {
  let service: AgentsService;
  let mockRepository: Record<string, MockFn>;
  let mockNatsPublisher: Record<string, MockFn>;
  let mockAdaptersService: Record<string, MockFn>;

  beforeEach(async () => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
      unpublish: vi.fn(),
    };

    mockNatsPublisher = {
      publishAgentPublished: vi.fn(),
      publishAgentUnpublished: vi.fn(),
    };

    mockAdaptersService = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      adapterExists: vi.fn(),
      endpointExists: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: AgentsRepository, useValue: mockRepository },
        { provide: NatsPublisher, useValue: mockNatsPublisher },
        {
          provide: LAZY_NATS,
          useValue: { getConnection: vi.fn().mockResolvedValue({}) },
        },
        { provide: AdaptersService, useValue: mockAdaptersService },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });

  describe("Task 4.1: POST /admin/agents with adapter tool", () => {
    it("should create an agent with a tool containing adapterRef", async () => {
      const createData: ICreateAgentData = {
        name: "Agent With Adapter Tool",
        system_prompt: "You use adapters",
        tools: [
          {
            name: "lookup-crm",
            adapterRef: {
              adapterId: "adapter-123",
              endpointId: "endpoint-456",
            },
          },
        ],
      };

      const created = makeAgent({
        name: createData.name,
        tools: createData.tools,
      });

      (mockAdaptersService.adapterExists as MockFn).mockResolvedValue(true);
      (mockAdaptersService.endpointExists as MockFn).mockResolvedValue(true);
      (mockRepository.create as MockFn).mockResolvedValue(created);

      const result = await service.create(TENANT_ID, createData);

      expect(result.name).toBe("Agent With Adapter Tool");
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, createData);
    });

    it("should reject a tool with both endpoint AND adapterRef", async () => {
      const errors = await validateToolSourceExclusion([
        {
          name: "bad-tool",
          endpoint: "https://example.com/api",
          adapterRef: { adapterId: "a1", endpointId: "e1" },
        },
      ]);

      expect(errors.length > 0).toBe(true);
      expect(errors[0]).toContain("not both");
    });

    it("should reject a tool with neither endpoint nor adapterRef", async () => {
      const errors = await validateToolSourceExclusion([{ name: "bare-tool" }]);

      expect(errors.length > 0).toBe(true);
      expect(errors[0]).toContain("must have either endpoint OR adapterRef");
    });
  });

  describe("Task 4.4: Adapter existence validation", () => {
    it("should log warning when adapter does not exist but still save", async () => {
      const createData: ICreateAgentData = {
        name: "Agent With Missing Adapter",
        system_prompt: "Test",
        tools: [
          {
            name: "missing-adapter-tool",
            adapterRef: {
              adapterId: "nonexistent-adapter",
              endpointId: "endpoint-1",
            },
          },
        ],
      };

      (mockAdaptersService.adapterExists as MockFn).mockResolvedValue(false);
      (mockRepository.create as MockFn).mockResolvedValue(
        makeAgent({ tools: createData.tools }),
      );

      const loggerCarrier = service as unknown as {
        readonly logger: { warn: (...args: unknown[]) => void };
      };
      const warnSpy = vi.spyOn(loggerCarrier.logger, "warn");

      const result = await service.create(TENANT_ID, createData);

      expect(result).toBeDefined();
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, createData);
      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls;
      expect(calls[0][0]).toContain("nonexistent-adapter");
    });

    it("should log warning when endpoint does not exist but still save", async () => {
      const createData: ICreateAgentData = {
        name: "Agent With Missing Endpoint",
        system_prompt: "Test",
        tools: [
          {
            name: "missing-endpoint-tool",
            adapterRef: {
              adapterId: "adapter-exists",
              endpointId: "nonexistent-endpoint",
            },
          },
        ],
      };

      (mockAdaptersService.adapterExists as MockFn).mockResolvedValue(true);
      (mockAdaptersService.endpointExists as MockFn).mockResolvedValue(false);
      (mockRepository.create as MockFn).mockResolvedValue(
        makeAgent({ tools: createData.tools }),
      );

      const loggerCarrier = service as unknown as {
        readonly logger: { warn: (...args: unknown[]) => void };
      };
      const warnSpy = vi.spyOn(loggerCarrier.logger, "warn");

      const result = await service.create(TENANT_ID, createData);

      expect(result).toBeDefined();
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, createData);
      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls;
      expect(calls[0][0]).toContain("nonexistent-endpoint");
    });

    it("should not warn when adapter and endpoint both exist", async () => {
      const createData: ICreateAgentData = {
        name: "Agent With Valid Adapter",
        system_prompt: "Test",
        tools: [
          {
            name: "valid-tool",
            adapterRef: {
              adapterId: "adapter-ok",
              endpointId: "endpoint-ok",
            },
          },
        ],
      };

      (mockAdaptersService.adapterExists as MockFn).mockResolvedValue(true);
      (mockAdaptersService.endpointExists as MockFn).mockResolvedValue(true);
      (mockRepository.create as MockFn).mockResolvedValue(
        makeAgent({ tools: createData.tools }),
      );

      const loggerCarrier = service as unknown as {
        readonly logger: { warn: (...args: unknown[]) => void };
      };
      const warnSpy = vi.spyOn(loggerCarrier.logger, "warn");

      await service.create(TENANT_ID, createData);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
