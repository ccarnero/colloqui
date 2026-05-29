import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { AgentsMongoRepository } from "../../src/modules/agents/agents.mongo.repository";
import type { IAgent } from "../../src/modules/agents/agents.repository.interface";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { createMockDb, createMockTenantManager } from "../mongo-mock";

describe("AgentsMongoRepository", () => {
  let repository: AgentsMongoRepository;
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
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

    const db = createMockDb({
      agents: {
        countDocuments: vi.fn(async () => 1),
        find: vi.fn(() => ({
          sort: vi.fn(() => ({
            skip: vi.fn(() => ({
              limit: vi.fn(() => ({
                toArray: vi.fn(async () =>
                  mockAgents.map((a) => ({
                    _id: a.id,
                    ...a,
                  })),
                ),
              })),
            })),
          })),
        })),
        findOne: vi.fn(async () => ({
          _id: "agent-1",
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
        })),
        insertOne: vi.fn(async () => ({ acknowledged: true })),
        updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
        findOneAndUpdate: vi.fn(async () => ({
          _id: "agent-1",
          name: "Test Agent 1",
          description: "Description 1",
          system_prompt: "System prompt 1",
          model_config: {},
          tools: [],
          channels: [],
          status: "published",
          is_active: true,
          published_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        })),
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsMongoRepository,
        {
          provide: YoizenclawTenantConnectionManager,
          useValue: createMockTenantManager(db),
        },
      ],
    }).compile();

    repository = module.get<AgentsMongoRepository>(AgentsMongoRepository);
  });

  it("findAll returns agents with total", async () => {
    const result = await repository.findAll(TENANT_ID);
    expect(result.total).toBe(1);
    expect(result.agents).toHaveLength(1);
  });

  it("findById returns agent when found", async () => {
    const agent = await repository.findById(TENANT_ID, "agent-1");
    expect(agent?.id).toBe("agent-1");
  });

  it("create inserts a new agent", async () => {
    const agent = await repository.create(TENANT_ID, {
      name: "New Agent",
      system_prompt: "Prompt",
    });
    expect(agent.name).toBe("New Agent");
  });

  it("publish sets status to published", async () => {
    const agent = await repository.publish(TENANT_ID, "agent-1");
    expect(agent?.status).toBe("published");
  });
});
