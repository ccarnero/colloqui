import "../setup-env";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  mock,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AgentsModule } from "../../src/modules/agents/agents.module";
import { TenantConnectionManager } from "@yoizen/database";
import { LAZY_NATS, NatsPublisher } from "../../src/providers/nats.provider";
import { TENANT_HEADER } from "@yoizen/shared";

// Mock implementations for integration tests
const createMockTenantConnectionManager = () => {
  const pools = new Map();

  return {
    getConnection: (tenantId: string) => {
      if (!pools.has(tenantId)) {
        // Return a mock SQL connection
        pools.set(tenantId, {
          unsafe: (value: string) => value,
          json: (value: unknown) => JSON.stringify(value),
        });
      }
      return pools.get(tenantId);
    },
    closeAll: async () => {
      pools.clear();
    },
  };
};

const createMockNatsPublisher = () => ({
  publishAgentPublished: async () => null,
  publishAgentUnpublished: async () => null,
});

const createMockLazyNats = () => ({
  getConnection: mock(() =>
    Promise.resolve({
      publish: mock(() => Promise.resolve()),
      request: mock(() =>
        Promise.resolve({
          data: Buffer.from(
            JSON.stringify({
              data: {
                payload: {
                  response: "integration-chat-reply",
                  tool_calls: [],
                },
              },
            }),
          ),
        }),
      ),
    } as import("nats").NatsConnection),
  ),
});

describe("Agents Integration Tests", () => {
  let app: INestApplication;
  let mockConnectionManager: ReturnType<
    typeof createMockTenantConnectionManager
  >;
  let mockNatsPublisher: ReturnType<typeof createMockNatsPublisher>;
  let mockLazyNats: ReturnType<typeof createMockLazyNats>;
  const TENANT_ID = "test-tenant-123";

  beforeAll(async () => {
    mockConnectionManager = createMockTenantConnectionManager();
    mockNatsPublisher = createMockNatsPublisher();
    mockLazyNats = createMockLazyNats();

    const module = await Test.createTestingModule({
      imports: [AgentsModule],
      providers: [{ provide: LAZY_NATS, useValue: mockLazyNats }],
    })
      .overrideProvider(TenantConnectionManager)
      .useValue(mockConnectionManager)
      .overrideProvider(NatsPublisher)
      .useValue(mockNatsPublisher)
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await mockConnectionManager.closeAll();
    await app.close();
  });

  beforeEach(() => {
    // Reset mocks before each test
  });

  describe("POST /admin/agents", () => {
    it("should create a new agent", async () => {
      const agentData = {
        name: "Test Agent",
        system_prompt: "You are a test assistant",
        model_config: { model: "gpt-4" },
        tools: [{ type: "search" }],
        channels: [{ type: "webchat" }],
      };

      const response = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send(agentData)
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.name).toBe(agentData.name);
      expect(response.body.system_prompt).toBe(agentData.system_prompt);
      expect(response.body.status).toBe("draft");
      expect(response.body.is_active).toBe(true);
    });

    it("should validate required fields", async () => {
      const invalidData = {
        name: "",
        system_prompt: "",
      };

      await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send(invalidData)
        .expect(400);
    });

    it("should require tenant header", async () => {
      const agentData = {
        name: "Test Agent",
        system_prompt: "You are a test assistant",
      };

      await request(app.getHttpServer())
        .post("/admin/agents")
        .send(agentData)
        .expect(400);
    });
  });

  describe("GET /admin/agents", () => {
    it("should list agents with pagination", async () => {
      const response = await request(app.getHttpServer())
        .get("/admin/agents?limit=10&offset=0")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("agents");
      expect(response.body).toHaveProperty("total");
      expect(Array.isArray(response.body.agents)).toBe(true);
    });

    it("should filter by status", async () => {
      const response = await request(app.getHttpServer())
        .get("/admin/agents?status=published")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("agents");
    });
  });

  describe("GET /admin/agents/:id", () => {
    it("should get agent by id", async () => {
      // First create an agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Test Agent",
          system_prompt: "You are a test assistant",
        })
        .expect(201);

      const agentId = createResponse.body.id;

      // Then get it
      const response = await request(app.getHttpServer())
        .get(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.id).toBe(agentId);
      expect(response.body.name).toBe("Test Agent");
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .get("/admin/agents/non-existent-id")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("PUT /admin/agents/:id", () => {
    it("should update agent", async () => {
      // First create an agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Original Name",
          system_prompt: "Original prompt",
        })
        .expect(201);

      const agentId = createResponse.body.id;

      // Update it
      const response = await request(app.getHttpServer())
        .put(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Updated Name",
          system_prompt: "Updated prompt",
        })
        .expect(200);

      expect(response.body.name).toBe("Updated Name");
      expect(response.body.system_prompt).toBe("Updated prompt");
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .put("/admin/agents/non-existent-id")
        .set(TENANT_HEADER, TENANT_ID)
        .send({ name: "New Name" })
        .expect(404);
    });
  });

  describe("DELETE /admin/agents/:id", () => {
    it("should soft delete agent", async () => {
      // First create an agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Agent to Delete",
          system_prompt: "You will be deleted",
        })
        .expect(201);

      const agentId = createResponse.body.id;

      // Delete it
      await request(app.getHttpServer())
        .delete(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(204);

      // Verify it's gone
      await request(app.getHttpServer())
        .get(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .delete("/admin/agents/non-existent-id")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("POST /admin/agents/:id/publish", () => {
    it("should publish agent and emit event", async () => {
      // First create an agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Agent to Publish",
          system_prompt: "You will be published",
        })
        .expect(201);

      const agentId = createResponse.body.id;

      // Publish it
      const response = await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/publish`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.status).toBe("published");
      expect(response.body.published_at).not.toBeNull();
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .post("/admin/agents/non-existent-id/publish")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("POST /admin/agents/:id/chat", () => {
    it("returns reply when agent is published", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Chat Agent",
          system_prompt: "You chat",
        })
        .expect(201);

      const agentId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/publish`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      const chatRes = await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/chat`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({ message: "Hello" })
        .expect(200);

      expect(chatRes.body.reply).toBe("integration-chat-reply");
    });
  });

  describe("POST /admin/agents/:id/unpublish", () => {
    it("should unpublish agent and emit event", async () => {
      // First create and publish an agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Agent to Unpublish",
          system_prompt: "You will be unpublished",
        })
        .expect(201);

      const agentId = createResponse.body.id;

      // Publish first
      await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/publish`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      // Then unpublish
      const response = await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/unpublish`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.status).toBe("draft");
      expect(response.body.published_at).toBeNull();
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .post("/admin/agents/non-existent-id/unpublish")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("Complete workflow", () => {
    it("should handle full agent lifecycle", async () => {
      // 1. Create agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Lifecycle Agent",
          description: "Testing full lifecycle",
          system_prompt: "You are a lifecycle test agent",
          model_config: { model: "gpt-4" },
          tools: [{ type: "search" }],
          channels: [{ type: "webchat" }],
        })
        .expect(201);

      const agentId = createResponse.body.id;
      expect(createResponse.body.status).toBe("draft");

      // 2. List agents - should include the new one
      const listResponse = await request(app.getHttpServer())
        .get("/admin/agents")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(listResponse.body.agents.length).toBeGreaterThan(0);

      // 3. Get agent by id
      const getResponse = await request(app.getHttpServer())
        .get(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(getResponse.body.name).toBe("Lifecycle Agent");

      // 4. Update agent
      const updateResponse = await request(app.getHttpServer())
        .put(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Updated Lifecycle Agent",
          description: "Updated description",
        })
        .expect(200);

      expect(updateResponse.body.name).toBe("Updated Lifecycle Agent");

      // 5. Publish agent
      const publishResponse = await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/publish`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(publishResponse.body.status).toBe("published");

      // 6. Filter by published status
      const publishedListResponse = await request(app.getHttpServer())
        .get("/admin/agents?status=published")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(publishedListResponse.body.agents.length).toBeGreaterThan(0);

      // 7. Unpublish agent
      const unpublishResponse = await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/unpublish`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(unpublishResponse.body.status).toBe("draft");

      // 8. Delete agent
      await request(app.getHttpServer())
        .delete(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(204);

      // 9. Verify deletion
      await request(app.getHttpServer())
        .get(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });
});
