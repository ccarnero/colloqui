import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TENANT_HEADER } from "@yoizen/shared";
import request from "supertest";
import { AgentsModule } from "../../src/modules/agents/agents.module";
import { AGENTS_REPOSITORY } from "../../src/modules/agents/agents.repository.interface";
import { LAZY_NATS, NatsPublisher } from "../../src/providers/nats.provider";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  createIntegrationApp,
  createIntegrationLazyNats,
  createIntegrationTenantConnectionManager,
} from "./harness";
import { createInMemoryAgentsRepository } from "./in-memory-repositories";

const createMockNatsPublisher = () => ({
  publishAgentPublished: async () => null,
  publishAgentUnpublished: async () => null,
});

describe("Agents Integration Tests", () => {
  let app: NestFastifyApplication;
  let mockNatsPublisher: ReturnType<typeof createMockNatsPublisher>;
  const TENANT_ID = "test-tenant-123";

  beforeAll(async () => {
    mockNatsPublisher = createMockNatsPublisher();

    app = await createIntegrationApp({
      imports: [AgentsModule],
      globals: [
        { provide: NatsPublisher, useValue: mockNatsPublisher },
        { provide: LAZY_NATS, useValue: createIntegrationLazyNats() },
        {
          provide: YoizenclawTenantConnectionManager,
          useValue: createIntegrationTenantConnectionManager(),
        },
      ],
      overrides: [
        { token: AGENTS_REPOSITORY, value: createInMemoryAgentsRepository() },
      ],
    });
  });

  afterAll(async () => {
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
