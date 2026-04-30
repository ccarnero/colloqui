import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AgentsRepository,
  type IAgent,
  type ICreateAgentData,
} from "../../src/modules/agents/agents.repository";
import {
  TenantConnectionManager,
  type Sql,
} from "@yoizen/database";
import { mockSqlSequentialResponses } from "../mock-utils";

// Mock postgres sql tagged template
const createMockSql = (): Sql => {
  const mockQuery = vi.fn();

  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      return mockQuery(strings, ...values);
    },
    {
      unsafe: vi.fn((value: string) => value),
      json: vi.fn((value: unknown) => JSON.stringify(value)),
      begin: vi.fn(),
      end: vi.fn(),
    },
  ) as unknown as Sql;

  // Attach the mockQuery to access it in tests
  (sql as unknown as { _mockQuery: typeof mockQuery })._mockQuery = mockQuery;

  return sql;
};

describe("AgentsRepository", () => {
  let repository: AgentsRepository;
  let mockConnectionManager: TenantConnectionManager;
  let mockSql: Sql;
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
    mockSql = createMockSql();

    mockConnectionManager = {
      ensureSchema: vi.fn(() => Promise.resolve()),
      getConnection: vi.fn().mockReturnValue(mockSql),
    } as unknown as TenantConnectionManager;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsRepository,
        {
          provide: TenantConnectionManager,
          useValue: mockConnectionManager,
        },
      ],
    }).compile();

    repository = module.get<AgentsRepository>(AgentsRepository);
  });

  describe("findAll", () => {
    it("should return agents with default pagination", async () => {
      const mockAgents: IAgent[] = [
        {
          id: "agent-1",
          name: "Test Agent 1",
          description: "Description 1",
          system_prompt: "System prompt 1",
          model_config: {},
          tools: [],
          channels: [],
          status: "draft",
          is_active: true,
          published_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;

      // First call is for count
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      // Second call is for agents
      mockQuery.mockResolvedValueOnce(mockAgents);

      const result = await repository.findAll(TENANT_ID);

      expect(result.agents).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockConnectionManager.getConnection).toHaveBeenCalledWith(
        TENANT_ID,
      );
    });

    it("should filter by status", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 0 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { status: "published" });

      expect(mockQuery).toHaveBeenCalled();
    });

    it("should use custom limit and offset", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 100 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("should return agent by id", async () => {
      const mockAgent: IAgent = {
        id: "agent-1",
        name: "Test Agent",
        description: "Description",
        system_prompt: "System prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([mockAgent]);

      const result = await repository.findById(TENANT_ID, "agent-1");

      expect(result).toEqual(mockAgent);
    });

    it("should return null when agent not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.findById(TENANT_ID, "non-existent");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("should create a new agent", async () => {
      const createData: ICreateAgentData = {
        name: "New Agent",
        system_prompt: "You are a helpful assistant",
        model_config: { model: "gpt-4" },
        tools: [{ type: "search" }],
        channels: [{ type: "webchat" }],
      };

      const createdAgent: IAgent = {
        id: "new-agent-id",
        name: createData.name,
        description: null,
        system_prompt: createData.system_prompt,
        model_config: createData.model_config!,
        tools: createData.tools!,
        channels: createData.channels!,
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdAgent]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.id).toBe("new-agent-id");
      expect(result.status).toBe("draft");
      expect(result.is_active).toBe(true);
    });

    it("should create agent with minimal data", async () => {
      const createData: ICreateAgentData = {
        name: "Minimal Agent",
        system_prompt: "You are helpful",
      };

      const createdAgent: IAgent = {
        id: "minimal-id",
        name: createData.name,
        description: null,
        system_prompt: createData.system_prompt,
        model_config: {},
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdAgent]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.model_config).toEqual({});
      expect(result.tools).toEqual([]);
    });
  });

  describe("update", () => {
    it("should update agent fields", async () => {
      const updatedAgent: IAgent = {
        id: "agent-1",
        name: "Updated Name",
        description: "Updated description",
        system_prompt: "Updated prompt",
        model_config: { model: "gpt-4" },
        tools: [],
        channels: [],
        status: "draft",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [[], [], [updatedAgent]]);

      const result = await repository.update(TENANT_ID, "agent-1", {
        name: "Updated Name",
        description: "Updated description",
      });

      expect(result).toEqual(updatedAgent);
    });

    it("should return null when agent not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [[], []]);

      const result = await repository.update(TENANT_ID, "non-existent", {
        name: "New Name",
      });

      expect(result).toBeNull();
    });

    it("should update status field", async () => {
      const updatedAgent: IAgent = {
        id: "agent-1",
        name: "Test Agent",
        description: null,
        system_prompt: "Prompt",
        model_config: {},
        tools: [],
        channels: [],
        status: "archived",
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [[], [updatedAgent]]);

      const result = await repository.update(TENANT_ID, "agent-1", {
        status: "archived",
      });

      expect(result?.status).toBe("archived");
    });
  });

  describe("delete", () => {
    it("should soft delete agent", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ id: "agent-1" }]);

      const result = await repository.delete(TENANT_ID, "agent-1");

      expect(result).toBe(true);
    });

    it("should return false when agent not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.delete(TENANT_ID, "non-existent");

      expect(result).toBe(false);
    });
  });

  describe("publish", () => {
    it("should publish agent", async () => {
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

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([publishedAgent]);

      const result = await repository.publish(TENANT_ID, "agent-1");

      expect(result?.status).toBe("published");
      expect(result?.published_at).not.toBeNull();
    });

    it("should return null when agent not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.publish(TENANT_ID, "non-existent");

      expect(result).toBeNull();
    });
  });

  describe("unpublish", () => {
    it("should unpublish agent", async () => {
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

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([unpublishedAgent]);

      const result = await repository.unpublish(TENANT_ID, "agent-1");

      expect(result?.status).toBe("draft");
      expect(result?.published_at).toBeNull();
    });

    it("should return null when agent not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.unpublish(TENANT_ID, "non-existent");

      expect(result).toBeNull();
    });
  });
});
