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
  getEventsByType,
  type TestContext,
  type TestTenant,
} from "./setup";

const AGENT_PUBLISHED_TYPE = "io.yoizen.platform.admin.agent.published.v1";
const AGENT_UNPUBLISHED_TYPE =
  "io.yoizen.platform.admin.agent.unpublished.v1";
const CREDENTIAL_ROTATED_TYPE =
  "io.yoizen.platform.admin.credential.rotated.v1";
const RUNTIME_CONFIG_SYNC_TYPE =
  "io.yoizen.platform.runtime.config.synced.v1";
const JOB_TRIGGER_TYPE = "io.yoizen.platform.admin.job.triggered.v1";
const AGENT_PUBLISHED_SUBJECT =
  "evt.nats-events-tenant.agent-admin-service.automation.platform.internal.agent_published.v1";

describe("NATS Events E2E Tests", () => {
  let app: INestApplication;
  let context: TestContext;
  let tenant: TestTenant;

  beforeAll(async () => {
    context = await setupPostgres();
    tenant = await createTestTenant(context, "nats-events-tenant");

    const mockNatsPublisher = createMockNatsPublisher(context);

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

  describe("Event Structure Validation", () => {
    it("should emit event with correct structure on agent publish", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Event Test Agent', 'Prompt', 'draft')
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, "agent.published");
      expect(event).toBeDefined();

      // Verificar estructura del evento
      expect(event).toHaveProperty("specversion");
      expect(event).toHaveProperty("source");
      expect(event).toHaveProperty("subject");
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("resource");
      expect(event).toHaveProperty("traceid");
      expect(event).toHaveProperty("correlation_id");
      expect(event).toHaveProperty("tenant");
      expect(event).toHaveProperty("producer");
      expect(event).toHaveProperty("data");

      // Verificar campos requeridos en payload
      expect(event!.data.payload).toHaveProperty("agentId");
      expect(event!.data.payload).toHaveProperty("name");
      expect(event!.data.payload).toHaveProperty("publishedAt");
      expect(event!.data.payload).toHaveProperty("status");

      // Verificar envelope
      expect(event!.specversion).toBe("1.0");
      expect(event!.tenant).toBe(tenant.id);
      expect(event!.producer).toBe("agent-admin-service");
      expect(event!.source).toBe(
        "//agent-admin-service/admin/agents/publish",
      );
      expect(event!.data.payload_inline).toBe(true);
      expect(event!.data.payload_ref).toBeNull();

      // Verificar valores
      expect(event!.type).toBe(AGENT_PUBLISHED_TYPE);
      expect(event!.subject).toBe(AGENT_PUBLISHED_SUBJECT);
      expect(event!.data.payload?.agentId).toBe(agent.id);
      expect(event!.metadata.tenantId).toBe(tenant.id);
      expect(event!.metadata.source).toBe(
        "//agent-admin-service/admin/agents/publish",
      );
      expect(typeof event!.metadata.timestamp).toBe("number");
    });

    it("should emit event with correct structure on agent unpublish", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status, published_at)
        VALUES ('Unpublish Test Agent', 'Prompt', 'published', NOW())
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/unpublish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, "agent.unpublished");
      expect(event).toBeDefined();

      // Verificar estructura
      expect(event!.payload).toHaveProperty("agentId");
      expect(event!.payload).toHaveProperty("name");
      expect(event!.payload).toHaveProperty("unpublishedAt");
      expect(event!.payload).toHaveProperty("status");

      expect(event!.metadata).toHaveProperty("tenantId");
      expect(event!.metadata).toHaveProperty("timestamp");
      expect(event!.metadata).toHaveProperty("source");

      expect(event!.type).toBe(AGENT_UNPUBLISHED_TYPE);
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });
  });

  describe("Agent Publish/Unpublish Events", () => {
    it("should emit agent.published event when publishing agent", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Publish Event Agent', 'Prompt', 'draft')
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, "agent.published");
      expect(event).toBeDefined();
      expect(event!.type).toBe(AGENT_PUBLISHED_TYPE);
      expect(event!.payload.agentId).toBe(agent.id);
      expect(event!.payload.name).toBe("Publish Event Agent");
      expect(event!.payload.status).toBe("published");
    });

    it("should emit agent.unpublished event when unpublishing agent", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status, published_at)
        VALUES ('Unpublish Event Agent', 'Prompt', 'published', NOW())
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/unpublish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, "agent.unpublished");
      expect(event).toBeDefined();
      expect(event!.type).toBe(AGENT_UNPUBLISHED_TYPE);
      expect(event!.payload.agentId).toBe(agent.id);
      expect(event!.payload.status).toBe("draft");
    });

    it("should emit both events for publish-unpublish cycle", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Cycle Agent', 'Prompt', 'draft')
        RETURNING id;
      `;

      // Publish
      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      // Unpublish
      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/unpublish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const publishEvents = getEventsByType(context, "agent.published");
      const unpublishEvents = getEventsByType(context, "agent.unpublished");

      expect(publishEvents.length).toBe(1);
      expect(unpublishEvents.length).toBe(1);

      expect(publishEvents[0].payload.agentId).toBe(agent.id);
      expect(unpublishEvents[0].payload.agentId).toBe(agent.id);
    });
  });

  describe("Credential Rotated Events", () => {
    it("should emit credential.rotated event when rotating credential", async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Rotatable Credential', 'api_key', 'old-value')
        RETURNING id, type;
      `;

      await request(app.getHttpServer())
        .put(`/admin/credentials/${credential.id}/rotate`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          new_value: "new-rotated-value",
        })
        .expect(200);

      const event = getLastEventByType(context, "credential.rotated");
      expect(event).toBeDefined();
      expect(event!.type).toBe(CREDENTIAL_ROTATED_TYPE);
      expect(event!.payload.credentialId).toBe(credential.id);
      expect(event!.payload.type).toBe("api_key");
      expect(event!.payload).toHaveProperty("rotatedAt");
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });

    it("should emit credential.rotated event when updating credential value", async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Updatable Credential', 'oauth', 'original-token')
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .put(`/admin/credentials/${credential.id}`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          value: "updated-token-value",
        })
        .expect(200);

      const event = getLastEventByType(context, "credential.rotated");
      expect(event).toBeDefined();
      expect(event!.type).toBe(CREDENTIAL_ROTATED_TYPE);
    });
  });

  describe("Runtime Config Sync Events", () => {
    it("should emit runtime.config.sync event when deploying config files", async () => {
      // Crear algunos config files
      await tenant.sql`
        INSERT INTO config_files (name, path, content, format)
        VALUES 
          ('App Config', '/config/app.yaml', 'key: value', 'yaml'),
          ('API Config', '/config/api.json', '{"key": "value"}', 'json');
      `;

      await request(app.getHttpServer())
        .post("/admin/config-files/deploy")
        .set(TENANT_HEADER, tenant.id)
        .send({})
        .expect(200);

      const event = getLastEventByType(context, "runtime.config.sync");
      expect(event).toBeDefined();
      expect(event!.type).toBe(RUNTIME_CONFIG_SYNC_TYPE);
      expect(event!.payload).toHaveProperty("files");
      expect(event!.payload).toHaveProperty("deletePaths");
      expect(event!.payload).toHaveProperty("syncedAt");
      expect(Array.isArray(event!.payload.files)).toBe(true);
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });
  });

  describe("Job Trigger Events", () => {
    it("should emit job.trigger event when triggering job", async () => {
      // Crear agent primero
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Job Agent', 'Prompt', 'published')
        RETURNING id;
      `;

      // Crear job
      const [job] = await tenant.sql`
        INSERT INTO jobs (name, agent_id, schedule, is_active)
        VALUES ('Test Job', ${agent.id}, '0 0 * * *', true)
        RETURNING id;
      `;

      const triggerPayload = { customData: "test-value", priority: 1 };

      await request(app.getHttpServer())
        .post(`/admin/jobs/${job.id}/trigger`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          event_payload: triggerPayload,
        })
        .expect(201);

      const event = getLastEventByType(context, "job.trigger");
      expect(event).toBeDefined();
      expect(event!.type).toBe(JOB_TRIGGER_TYPE);
      expect(event!.payload.jobId).toBe(job.id);
      expect(event!.payload).toHaveProperty("executionId");
      expect(event!.payload.eventPayload).toEqual(triggerPayload);
      expect(event!.payload).toHaveProperty("triggeredAt");
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });

    it("should emit job.trigger event when running job manually", async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Manual Job Agent', 'Prompt', 'published')
        RETURNING id;
      `;

      const [job] = await tenant.sql`
        INSERT INTO jobs (name, agent_id, schedule, is_active)
        VALUES ('Manual Job', ${agent.id}, '0 0 * * *', true)
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/jobs/${job.id}/run`)
        .set(TENANT_HEADER, tenant.id)
        .expect(201);

      const event = getLastEventByType(context, "job.trigger");
      expect(event).toBeDefined();
      expect(event!.type).toBe(JOB_TRIGGER_TYPE);
      expect(event!.payload.jobId).toBe(job.id);
    });
  });

  describe("Multiple Event Scenarios", () => {
    it("should emit multiple events during complex workflow", async () => {
      // 1. Crear agent
      const createResponse = await request(app.getHttpServer())
        .post("/admin/agents")
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: "Complex Workflow Agent",
          system_prompt: "Prompt",
        })
        .expect(201);

      const agentId = createResponse.body.id;
      const initialEventCount = context.natsEvents.length;

      // 2. Publicar agent (evento 1)
      await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      // 3. Crear credential
      const credentialResponse = await request(app.getHttpServer())
        .post("/admin/credentials")
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: "Test Credential",
          type: "api_key",
          value: "secret",
        })
        .expect(201);

      const credentialId = credentialResponse.body.id;

      // 4. Rotar credential (evento 2)
      await request(app.getHttpServer())
        .put(`/admin/credentials/${credentialId}/rotate`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          new_value: "new-secret",
        })
        .expect(200);

      // Verificar que se emitieron todos los eventos esperados
      const publishEvents = getEventsByType(context, "agent.published");
      const rotateEvents = getEventsByType(context, "credential.rotated");

      expect(publishEvents.length).toBeGreaterThanOrEqual(1);
      expect(rotateEvents.length).toBeGreaterThanOrEqual(1);

      // Verificar que cada evento tiene la estructura correcta
      for (const event of context.natsEvents.slice(initialEventCount)) {
        expect(event).toHaveProperty("specversion");
        expect(event).toHaveProperty("subject");
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("resource");
        expect(event).toHaveProperty("data");
        expect(event.data).toHaveProperty("payload");
        expect(event).toHaveProperty("metadata");
        expect(event.metadata).toHaveProperty("tenantId");
        expect(event.metadata).toHaveProperty("timestamp");
        expect(event.metadata).toHaveProperty("source");
      }
    });
  });
});
