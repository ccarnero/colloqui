import "../pin-storage-engine";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import {
  createE2eApp,
  createMockNatsPublisher,
  createTestTenant,
  setupPostgres,
  type TestContext,
  type TestTenant,
  teardownTestContext,
} from "./setup";

/**
 * Bun rejects the per-hook `beforeAll(fn, ms)` timeout overload, so the budget
 * for pulling/starting the Postgres testcontainer is set process-wide — same
 * pattern as `services/connector-admin/test/integration/*`.
 */
setDefaultTimeout(180_000);

describe("Health E2E Tests", () => {
  let app: NestFastifyApplication;
  let context: TestContext;
  let tenant: TestTenant;

  beforeAll(async () => {
    context = await setupPostgres();
    tenant = await createTestTenant(context, "health-test-tenant");

    app = await createE2eApp({
      natsPublisher: createMockNatsPublisher(context),
      sql: tenant.sql,
      tenantId: tenant.id,
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

  describe("GET /health", () => {
    it("should return 200 with status ok", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.body).toHaveProperty("status");
      expect(response.body.status).toBe("ok");
    });

    it("should include timestamp in response", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.body).toHaveProperty("timestamp");
      expect(typeof response.body.timestamp).toBe("string");
      // Verificar que es una fecha ISO válida
      expect(new Date(response.body.timestamp).toISOString()).toBe(
        response.body.timestamp
      );
    });

    it("should include checks object", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.body).toHaveProperty("checks");
      expect(typeof response.body.checks).toBe("object");
    });

    it("should report database status", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.body.checks).toHaveProperty("database");
      expect(["up", "down"]).toContain(response.body.checks.database);
    });

    it("should return consistent response format", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      // Verificar estructura completa de la respuesta
      expect(response.body).toMatchObject({
        status: expect.any(String),
        timestamp: expect.any(String),
        checks: {
          database: expect.any(String),
        },
      });
    });

    it("should be accessible without authentication", async () => {
      // Health endpoint debe ser público para Knative/Kubernetes
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.body.status).toBe("ok");
    });

    it("should be accessible without tenant header", async () => {
      // Health check NO debe requerir tenant header
      const response = await request(app.getHttpServer())
        .get("/health")
        // No seteamos TENANT_HEADER
        .expect(200);

      expect(response.body.status).toBe("ok");
    });
  });

  describe("Health Check Reliability", () => {
    it("should return consistent results on multiple calls", async () => {
      const responses = await Promise.all([
        request(app.getHttpServer()).get("/health"),
        request(app.getHttpServer()).get("/health"),
        request(app.getHttpServer()).get("/health"),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("ok");
        expect(response.body).toHaveProperty("timestamp");
        expect(response.body).toHaveProperty("checks");
      }

      // Todos deben reportar el mismo estado de DB
      const dbStatuses = responses.map(
        (r: { body: { checks: { database: string } } }) =>
          r.body.checks.database
      );
      expect(new Set(dbStatuses).size).toBe(1); // Todos iguales
    });

    it("should have recent timestamp", async () => {
      const beforeRequest = Date.now();

      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      const afterRequest = Date.now();
      const responseTimestamp = new Date(response.body.timestamp).getTime();

      // El timestamp debe estar entre before y after
      expect(responseTimestamp).toBeGreaterThanOrEqual(beforeRequest - 1000); // 1s tolerancia
      expect(responseTimestamp).toBeLessThanOrEqual(afterRequest + 1000);
    });
  });

  describe("Health Check Response Headers", () => {
    it("should return appropriate content-type", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.headers["content-type"]).toContain("application/json");
    });
  });
});
