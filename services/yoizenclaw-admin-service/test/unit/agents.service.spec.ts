import { describe, it, expect, beforeEach, vi } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { AgentsService } from "../../src/modules/agents/agents.service";
import { AgentsRuntimeService } from "../../src/modules/agents/agents-runtime.service";
import type { IAgent, ICreateAgentData } from "../../src/modules/agents/agents.repository.interface";
import { NatsPublisher } from "../../src/providers/nats.provider";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";

type MockFn = ReturnType<typeof vi.fn>;
const mocked = <T extends MockFn>(fn: T): T => fn;

describe("AgentsService", () => {
  let service: AgentsService;
  let mockRepository: {
    findAll: MockFn;
    findById: MockFn;
    create: MockFn;
    update: MockFn;
    delete: MockFn;
    publish: MockFn;
    unpublish: MockFn;
  };
  let mockNatsPublisher: NatsPublisher;
  let mockRuntimeService: AgentsRuntimeService;
  let mockAdaptersService: AdaptersService;
  const TENANT_ID = "tenant-123";

  beforeEach(() => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
      unpublish: vi.fn(),
    } as typeof mockRepository;

    mockNatsPublisher = {
      publishAgentPublished: vi.fn(),
      publishAgentUnpublished: vi.fn(),
    } as unknown as NatsPublisher;

    mockRuntimeService = {
      chat: vi.fn(),
      listMemoryProposals: vi.fn(),
      reviewMemoryProposal: vi.fn(),
    } as unknown as AgentsRuntimeService;

    mockAdaptersService = {
      adapterExists: vi.fn(() => Promise.resolve(true)),
      endpointExists: vi.fn(() => Promise.resolve(true)),
    } as unknown as AdaptersService;

    service = new AgentsService(
      mockRepository,
      mockNatsPublisher,
      mockRuntimeService,
      mockAdaptersService,
    );
  });

  describe("findAll", () => {
    it("should return agents with pagination", async () => {
      const mockAgents = [
        {
          id: "agent-1",
          name: "Test Agent",
          description: null,
          system_prompt: "Prompt",
          model_config: {},
          tools: [],
          channels: [],
          status: "draft",
          is_active: true,
          published_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ] as IAgent[];

      mocked(mockRepository.findAll).mockResolvedValue({
        agents: mockAgents,
        total: 1,
      });

      const result = await service.findAll(TENANT_ID, {
        limit: 10,
        offset: 0,
      });

      expect(result.agents).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        limit: 10,
        offset: 0,
      });
    });

    it("should pass filter options to repository", async () => {
      mocked(mockRepository.findAll).mockResolvedValue({
        agents: [],
        total: 0,
      });

      await service.findAll(TENANT_ID, {
        status: "published",
        is_active: true,
      });

      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        status: "published",
        is_active: true,
      });
    });
  });

  describe("findById", () => {
    it("should return agent by id", async () => {
      const mockAgent: IAgent = {
        id: "agent-1",
        name: "Test Agent",
        description: null,
        system_prompt: "Prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      const result = await service.findById(TENANT_ID, "agent-1");

      expect(result).toEqual(mockAgent);
    });

    it("should throw NotFoundException when agent not found", async () => {
      mocked(mockRepository.findById).mockResolvedValue(null);

      expect(service.findById(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("should create a new agent", async () => {
      const createData: ICreateAgentData = {
        name: "New Agent",
        system_prompt: "You are helpful",
        model_config: { model: "gpt-4" },
      };

      const createdAgent: IAgent = {
        id: "new-id",
        ...createData,
        description: null,
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mocked(mockRepository.create).mockResolvedValue(createdAgent);

      const result = await service.create(TENANT_ID, createData);

      expect(result.name).toBe(createData.name);
      expect(result.system_prompt).toBe(createData.system_prompt);
      expect(mockRepository.create).toHaveBeenCalledWith(
        TENANT_ID,
        createData,
      );
    });
  });

  describe("update", () => {
    it("should update agent", async () => {
      const updateData = { name: "Updated Name" };
      const updatedAgent: IAgent = {
        id: "agent-1",
        name: "Updated Name",
        description: null,
        system_prompt: "Prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mocked(mockRepository.update).mockResolvedValue(updatedAgent);

      const result = await service.update(TENANT_ID, "agent-1", updateData);

      expect(result.name).toBe("Updated Name");
      expect(mockRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        "agent-1",
        updateData,
      );
    });

    it("should throw NotFoundException when agent not found", async () => {
      mocked(mockRepository.update).mockResolvedValue(null);

      expect(
        service.update(TENANT_ID, "non-existent", { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("should delete agent", async () => {
      mocked(mockRepository.delete).mockResolvedValue(true);

      await service.delete(TENANT_ID, "agent-1");

      expect(mockRepository.delete).toHaveBeenCalledWith(
        TENANT_ID,
        "agent-1",
      );
    });

    it("should throw NotFoundException when agent not found", async () => {
      mocked(mockRepository.delete).mockResolvedValue(false);

      expect(service.delete(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("publish", () => {
    it("should publish agent and emit event", async () => {
      const publishedAgent: IAgent = {
        id: "agent-1",
        name: "Test Agent",
        description: null,
        system_prompt: "Prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "published",
        is_active: true,
        published_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mocked(mockRepository.publish).mockResolvedValue(publishedAgent);
      mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(
        null,
      );

      const result = await service.publish(TENANT_ID, "agent-1");

      expect(result.status).toBe("published");
      expect(mockRepository.publish).toHaveBeenCalledWith(
        TENANT_ID,
        "agent-1",
      );
      expect(mockNatsPublisher.publishAgentPublished).toHaveBeenCalledWith(
        TENANT_ID,
        publishedAgent.id,
        publishedAgent.name,
        expect.any(Object),
      );
    });

    it("should throw NotFoundException when agent not found", async () => {
      mocked(mockRepository.publish).mockResolvedValue(null);

      expect(service.publish(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should not fail if event emission fails", async () => {
      const publishedAgent: IAgent = {
        id: "agent-1",
        name: "Test Agent",
        description: null,
        system_prompt: "Prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "published",
        is_active: true,
        published_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mocked(mockRepository.publish).mockResolvedValue(publishedAgent);
      mocked(mockNatsPublisher.publishAgentPublished).mockRejectedValue(
        new Error("NATS error"),
      );

      const result = await service.publish(TENANT_ID, "agent-1");

      expect(result.status).toBe("published");
    });
  });

  describe("unpublish", () => {
    it("should unpublish agent and emit event", async () => {
      const unpublishedAgent: IAgent = {
        id: "agent-1",
        name: "Test Agent",
        description: null,
        system_prompt: "Prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mocked(mockRepository.unpublish).mockResolvedValue(unpublishedAgent);
      mocked(mockNatsPublisher.publishAgentUnpublished).mockResolvedValue(
        null,
      );

      const result = await service.unpublish(TENANT_ID, "agent-1");

      expect(result.status).toBe("draft");
      expect(mockRepository.unpublish).toHaveBeenCalledWith(
        TENANT_ID,
        "agent-1",
      );
      expect(
        mockNatsPublisher.publishAgentUnpublished,
      ).toHaveBeenCalledWith(
        TENANT_ID,
        unpublishedAgent.id,
        unpublishedAgent.name,
      );
    });

    it("should throw NotFoundException when agent not found", async () => {
      mocked(mockRepository.unpublish).mockResolvedValue(null);

      expect(service.unpublish(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should not fail if event emission fails", async () => {
      const unpublishedAgent: IAgent = {
        id: "agent-1",
        name: "Test Agent",
        description: null,
        system_prompt: "Prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mocked(mockRepository.unpublish).mockResolvedValue(unpublishedAgent);
      mocked(mockNatsPublisher.publishAgentUnpublished).mockRejectedValue(
        new Error("NATS error"),
      );

      const result = await service.unpublish(TENANT_ID, "agent-1");

      expect(result.status).toBe("draft");
    });
  });

  describe("memory proposals", () => {
    it("should delegate listMemoryProposals to runtime service", async () => {
      mocked(mockRuntimeService.listMemoryProposals).mockResolvedValue({
        proposals: [],
      });

      const result = await service.listMemoryProposals(TENANT_ID);

      expect(mockRuntimeService.listMemoryProposals).toHaveBeenCalledWith(
        TENANT_ID,
      );
      expect(result.proposals).toEqual([]);
    });

    it("should delegate approveMemoryProposal to runtime service", async () => {
      mocked(mockRuntimeService.reviewMemoryProposal).mockResolvedValue({
        success: true,
      });

      const result = await service.approveMemoryProposal(
        TENANT_ID,
        "proposal-1",
        "reviewer",
      );

      expect(mockRuntimeService.reviewMemoryProposal).toHaveBeenCalledWith(
        TENANT_ID,
        "proposal-1",
        "memory_proposals_approve",
        "reviewer",
      );
      expect(result.success).toBe(true);
    });
  });
});
