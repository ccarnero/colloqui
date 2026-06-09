import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { TenantConnectionManager } from "@yoizen/database";
import { NatsPublisher } from "../../src/providers/nats.provider";
import { TENANT_HEADER } from "@yoizen/shared";
import {
  setupPostgres,
  createMockNatsPublisher,
  createTestTenant,
  cleanupTenantTables,
  clearNatsEvents,
  getLastEventByType,
  type TestContext,
  type TestTenant,
} from "./setup";

const AGENT_PUBLISHED_TYPE = "io.yoizen.platform.admin.agent.published.v1";
const AGENT_UNPUBLISHED_TYPE =
  "io.yoizen.platform.admin.agent.unpublished.v1";

describe("Agents E2E Tests", () => {
  let app: INestApplication;
  let context: TestContext;
  let tenant: TestTenant;

  beforeAll(async () => {
    context = await setupPostgres();
    tenant = await createTestTenant(context, "agents-test-tenant");

    const mockNatsPublisher = createMockNatsPublisher(context);

    // Mock TenantConnectionManager para usar el container de test
    const mockConnectionManager = {
      getConnection: () => tenant.sql,
      ensureSchema: async () => {},
      isInitialized: () => true,
      markInitialized: () => {},
      closeAll: async () => {},
      onModuleDestroy: async () => {},
    };

    const module = await Test.createTestingModule({
      imports: [AppModule],
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
    if (app) {
      await app.close();
    }
    if (context?.postgresContainer) {
      await context.postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    await cleanupTenantTables(context, tenant.id);
    clearNatsEvents(context);
  });

  describe("POST /admin/agents", () => {
    it("should create a new agent", async () => {
      const agentData = {
        name: "Test Agent",
        description: "A test agent",
        system_prompt: "You are a test assistant",
        model_config: { model: "gpt-4" },
        tools: [{ type: "search" }],
        channels: [{ type: "webchat" }],
      };

      const response = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, tenant.id)
        .send(agentData)
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.name).toBe(agentData.name);
      expect(response.body.description).toBe(agentData.description);
      expect(response.body.system_prompt).toBe(agentData.system_prompt);
      expect(response.body.model_config).toEqual(agentData.model_config);
      expect(response.body.tools).toEqual(agentData.tools);
      expect(response.body.channels).toEqual(agentData.channels);
      expect(response.body.status).toBe("draft");
      expect(response.body.is_active).toBe(true);
      expect(response.body.published_at).toBeNull();
    });

    it("should validate required fields", async () => {
      await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, tenant.id)
        .send({ name: "" })
        .expect(400);
    });
  });

  describe("GET /admin/agents", () => {
    it("should list all agents", async () => {
      // Crear algunos agents primero
      await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES 
          ('Agent 1', 'Prompt 1', 'draft'),
          ('Agent 2', 'Prompt 2', 'published'),
          ('Agent 3', 'Prompt 3', 'draft');
      `;

      const response = await request(app.getHttpServer())
        .get("/admin/agents")
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body).toHaveProperty("agents");
      expect(response.body).toHaveProperty("total");
      expect(Array.isArray(response.body.agents)).toBe(true);
      expect(response.body.agents.length).toBe(3);
      expect(response.body.total).toBe(3);
    });

    it("should filter agents by status", async () => {
      await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES 
          ('Agent 1', 'Prompt 1', 'draft'),
          ('Agent 2', 'Prompt 2', 'published'),
          ('Agent 3', 'Prompt 3', 'published');
      `;

      const response = await request(app.getHttpServer())
        .get("/admin/agents?status=published")
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.agents.length).toBe(2);
      expect(
        response.body.agents.every(
          (a: { status: string }) => a.status === "published",
        ),
      ).toBe(true);
    });
  });

  describe("GET /admin/agents/:id", () => {
    it("should get agent by id", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Test Agent', 'Test Prompt', 'draft')
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .get(`/admin/agents/${agent.id}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.id).toBe(agent.id);
      expect(response.body.name).toBe("Test Agent");
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .get("/admin/agents/12345678-1234-1234-1234-123456789012")
        .set(TENANT_HEADER, tenant.id)
        .expect(404);
    });
  });

  describe("PUT /admin/agents/:id", () => {
    it("should update agent", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Original Name', 'Original Prompt', 'draft')
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .put(`/admin/agents/${agent.id}`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: "Updated Name",
          system_prompt: "Updated Prompt",
        })
        .expect(200);

      expect(response.body.name).toBe("Updated Name");
      expect(response.body.system_prompt).toBe("Updated Prompt");
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .put("/admin/agents/12345678-1234-1234-1234-123456789012")
        .set(TENANT_HEADER, tenant.id)
        .send({ name: "New Name" })
        .expect(404);
    });
  });

  describe("DELETE /admin/agents/:id", () => {
    it("should delete agent", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Agent to Delete', 'Prompt', 'draft')
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .delete(`/admin/agents/${agent.id}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/admin/agents/${agent.id}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(404);
    });
  });

  describe("POST /admin/agents/:id/publish", () => {
    it("should publish agent and emit NATS event", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Agent to Publish', 'Prompt', 'draft')
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.status).toBe("published");
      expect(response.body.published_at).not.toBeNull();

      // Verificar evento NATS
      const event = getLastEventByType(context, "agent.published");
      expect(event).toBeDefined();
      expect(event!.type).toBe(AGENT_PUBLISHED_TYPE);
      expect(event!.payload.agentId).toBe(agent.id);
      expect(event!.payload.name).toBe("Agent to Publish");
      expect(event!.metadata.tenantId).toBe(tenant.id);
      expect(event!.metadata.source).toBe(
        "//agent-admin-service/admin/agents/publish",
      );
    });

    it("should return 404 for non-existent agent", async () => {
      await request(app.getHttpServer())
        .post("/admin/agents/12345678-1234-1234-1234-123456789012/publish")
        .set(TENANT_HEADER, tenant.id)
        .expect(404);
    });
  });

  describe("POST /admin/agents/:id/unpublish", () => {
    it("should unpublish agent and emit NATS event", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status, published_at)
        VALUES ('Agent to Unpublish', 'Prompt', 'published', NOW())
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/unpublish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.status).toBe("draft");
      expect(response.body.published_at).toBeNull();

      // Verificar evento NATS
      const event = getLastEventByType(context, "agent.unpublished");
      expect(event).toBeDefined();
      expect(event!.type).toBe(AGENT_UNPUBLISHED_TYPE);
      expect(event!.payload.agentId).toBe(agent.id);
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });
  });

  describe("Complete Agent Workflow", () => {
    it("should execute full lifecycle: Create → Publish → List → Update → Unpublish → Delete", async () => {
      // 1. Create agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: "Workflow Agent",
          description: "Testing full workflow",
          system_prompt: "You are a workflow test agent",
          model_config: { model: "gpt-4" },
          tools: [{ type: "search" }],
          channels: [{ type: "webchat" }],
        })
        .expect(201);

      const agentId = createResponse.body.id;
      expect(createResponse.body.status).toBe("draft");

      // 2. Publish agent
      const publishResponse = await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(publishResponse.body.status).toBe("published");

      // Verificar evento NATS de publicación
      const publishEvent = getLastEventByType(context, "agent.published");
      expect(publishEvent).toBeDefined();
      expect(publishEvent!.payload.agentId).toBe(agentId);

      // 3. List agents - should include published agent
      const listResponse = await request(app.getHttpServer())
        .get("/admin/agents?status=published")
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(listResponse.body.agents.length).toBeGreaterThan(0);
      expect(
        listResponse.body.agents.find((a: { id: string }) => a.id === agentId),
      ).toBeDefined();

      // 4. Update agent
      const updateResponse = await request(app.getHttpServer())
        .put(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: "Updated Workflow Agent",
          description: "Updated description",
        })
        .expect(200);

      expect(updateResponse.body.name).toBe("Updated Workflow Agent");

      // 5. Unpublish agent
      const unpublishResponse = await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/unpublish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(unpublishResponse.body.status).toBe("draft");

      // Verificar evento NATS de despublicación
      const unpublishEvent = getLastEventByType(context, "agent.unpublished");
      expect(unpublishEvent).toBeDefined();
      expect(unpublishEvent!.payload.agentId).toBe(agentId);

      // 6. Delete agent
      await request(app.getHttpServer())
        .delete(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(204);

      // 7. Verify deletion
      await request(app.getHttpServer())
        .get(`/admin/agents/${agentId}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(404);

      // Verificar que tenemos ambos eventos NATS
      const events = context.natsEvents;
      expect(
        events.filter((event) => event.eventName === "agent.published").length,
      ).toBe(1);
      expect(
        events.filter((event) => event.eventName === "agent.unpublished")
          .length,
      ).toBe(1);
    });
  });
});
