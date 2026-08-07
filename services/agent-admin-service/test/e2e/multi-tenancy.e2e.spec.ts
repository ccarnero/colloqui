import "../pin-storage-engine";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TENANT_HEADER } from "@yoizen/shared";
import request from "supertest";
import {
  cleanupTenantTables,
  createE2eApp,
  createMockNatsPublisher,
  createTestTenant,
  setupPostgres,
  type TestContext,
  type TestTenant,
  teardownTestContext,
} from "./setup";

/** See the note in `health.e2e.spec.ts` — bun rejects `beforeAll(fn, ms)`. */
setDefaultTimeout(180_000);

describe("Multi-Tenancy E2E Tests", () => {
  let app: NestFastifyApplication;
  let context: TestContext;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    context = await setupPostgres();
    tenantA = await createTestTenant(context, "tenant-a");
    tenantB = await createTestTenant(context, "tenant-b");

    // Por defecto apunta a tenantA; cada test levanta su propia app cuando
    // necesita la conexión del otro tenant.
    app = await createE2eApp({
      natsPublisher: createMockNatsPublisher(context),
      sql: tenantA.sql,
      tenantId: tenantA.id,
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (context) {
      await teardownTestContext(context);
    }
  });

  beforeEach(async () => {
    await cleanupTenantTables(context, tenantA.id);
    await cleanupTenantTables(context, tenantB.id);
  });

  describe("Tenant Isolation - Agents", () => {
    it("Tenant A should only see their own agents", async () => {
      // Crear 3 agents en Tenant A directamente en DB
      await tenantA.sql`
        INSERT INTO agents (id, name, system_prompt, status)
        VALUES
          (gen_random_uuid(), 'Tenant A Agent 1', 'Prompt 1', 'draft'),
          (gen_random_uuid(), 'Tenant A Agent 2', 'Prompt 2', 'draft'),
          (gen_random_uuid(), 'Tenant A Agent 3', 'Prompt 3', 'draft');
      `;

      // Crear 2 agents diferentes en Tenant B directamente en DB
      await tenantB.sql`
        INSERT INTO agents (id, name, system_prompt, status)
        VALUES
          (gen_random_uuid(), 'Tenant B Agent 1', 'Prompt 1', 'draft'),
          (gen_random_uuid(), 'Tenant B Agent 2', 'Prompt 2', 'draft');
      `;

      // App temporal para Tenant A
      const appA = await createE2eApp({
        natsPublisher: createMockNatsPublisher(context),
        sql: tenantA.sql,
        tenantId: tenantA.id,
      });

      // Tenant A lista sus agents
      const responseA = await request(appA.getHttpServer())
        .get("/admin/agents")
        .set(TENANT_HEADER, tenantA.id)
        .expect(200);

      expect(responseA.body.agents.length).toBe(3);
      expect(responseA.body.total).toBe(3);
      expect(
        responseA.body.agents.every((a: { name: string }) =>
          a.name.includes("Tenant A")
        )
      ).toBe(true);

      await appA.close();

      // App temporal para Tenant B
      const appB = await createE2eApp({
        natsPublisher: createMockNatsPublisher(context),
        sql: tenantB.sql,
        tenantId: tenantB.id,
      });

      // Tenant B lista sus agents
      const responseB = await request(appB.getHttpServer())
        .get("/admin/agents")
        .set(TENANT_HEADER, tenantB.id)
        .expect(200);

      expect(responseB.body.agents.length).toBe(2);
      expect(responseB.body.total).toBe(2);
      expect(
        responseB.body.agents.every((a: { name: string }) =>
          a.name.includes("Tenant B")
        )
      ).toBe(true);

      await appB.close();
    });

    it("Tenant B cannot access Tenant A agent by ID", async () => {
      // Crear agent en Tenant A
      const [agentA] = await tenantA.sql`
        INSERT INTO agents (id, name, system_prompt, status)
        VALUES (gen_random_uuid(), 'Secret Agent A', 'Secret Prompt', 'draft')
        RETURNING id;
      `;

      // App para Tenant B intentando acceder a agent de Tenant A
      const appB = await createE2eApp({
        natsPublisher: createMockNatsPublisher(context),
        sql: tenantB.sql,
        tenantId: tenantB.id,
      });

      // Tenant B intenta acceder al agent de Tenant A - debería retornar 404
      await request(appB.getHttpServer())
        .get(`/admin/agents/${agentA.id}`)
        .set(TENANT_HEADER, tenantB.id)
        .expect(404);

      await appB.close();
    });

    it("Tenant B cannot modify Tenant A agent", async () => {
      // Crear agent en Tenant A
      await tenantA.sql`
        INSERT INTO agents (id, name, system_prompt, status)
        VALUES (gen_random_uuid(), 'Protected Agent A', 'Protected Prompt', 'draft')
        RETURNING id;
      `;

      // App para Tenant B intentando modificar agent de Tenant A
      const appB = await createE2eApp({
        natsPublisher: createMockNatsPublisher(context),
        sql: tenantB.sql,
        tenantId: tenantB.id,
      });

      await appB.close();
    });
  });

  describe("Mixed Tenant Operations", () => {
    it("should handle concurrent operations from different tenants", async () => {
      // Configurar ambas aplicaciones
      const appA = await createE2eApp({
        natsPublisher: createMockNatsPublisher(context),
        sql: tenantA.sql,
        tenantId: tenantA.id,
      });
      const appB = await createE2eApp({
        natsPublisher: createMockNatsPublisher(context),
        sql: tenantB.sql,
        tenantId: tenantB.id,
      });

      // Operaciones concurrentes
      const [responseA, responseB] = await Promise.all([
        request(appA.getHttpServer())
          .post("/admin/agents")
          .set(TENANT_HEADER, tenantA.id)
          .send({
            name: "Concurrent Agent A",
            system_prompt: "Prompt A",
          }),
        request(appB.getHttpServer())
          .post("/admin/agents")
          .set(TENANT_HEADER, tenantB.id)
          .send({
            name: "Concurrent Agent B",
            system_prompt: "Prompt B",
          }),
      ]);

      expect(responseA.status).toBe(201);
      expect(responseB.status).toBe(201);

      const agentAId = responseA.body.id;
      const agentBId = responseB.body.id;

      // Verificar que cada tenant solo ve su propio agent
      const listA = await request(appA.getHttpServer())
        .get("/admin/agents")
        .set(TENANT_HEADER, tenantA.id)
        .expect(200);

      const listB = await request(appB.getHttpServer())
        .get("/admin/agents")
        .set(TENANT_HEADER, tenantB.id)
        .expect(200);

      expect(listA.body.agents.length).toBe(1);
      expect(listA.body.agents[0].id).toBe(agentAId);

      expect(listB.body.agents.length).toBe(1);
      expect(listB.body.agents[0].id).toBe(agentBId);

      // Verificar cross-tenant access devuelve 404
      await request(appA.getHttpServer())
        .get(`/admin/agents/${agentBId}`)
        .set(TENANT_HEADER, tenantA.id)
        .expect(404);

      await request(appB.getHttpServer())
        .get(`/admin/agents/${agentAId}`)
        .set(TENANT_HEADER, tenantB.id)
        .expect(404);

      await appA.close();
      await appB.close();
    });
  });
});
