import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TenantConnectionManager } from '../../src/providers/tenant-connection-manager';
import { NatsPublisher } from '../../src/providers/nats.provider';
import {
  setupPostgres,
  createMockNatsPublisher,
  createTestTenant,
  type TestContext,
  type TestTenant,
} from './setup';

describe('Health E2E Tests', () => {
  let app: INestApplication;
  let context: TestContext;
  let tenant: TestTenant;

  beforeAll(async () => {
    context = await setupPostgres();
    tenant = await createTestTenant(context, 'health-test-tenant');

    const mockNatsPublisher = createMockNatsPublisher(context);

    // Mock para HealthController que usa TenantConnectionManager
    const mockConnectionManager = {
      getConnection: () => tenant.sql,
      ensureSchema: async () => {},
      isSchemaInitialized: () => true,
      markSchemaInitialized: () => {},
      closeAll: async () => {},
      onModuleDestroy: async () => {},
      // Simular la propiedad interna pools
      pools: new Map(),
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
    await context.postgresContainer.stop();
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('ok');
    });

    it('should include timestamp in response', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(typeof response.body.timestamp).toBe('string');
      // Verificar que es una fecha ISO válida
      expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
    });

    it('should include checks object', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('checks');
      expect(typeof response.body.checks).toBe('object');
    });

    it('should report database status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.checks).toHaveProperty('database');
      expect(['up', 'down']).toContain(response.body.checks.database);
    });

    it('should return consistent response format', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
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

    it('should be accessible without authentication', async () => {
      // Health endpoint debe ser público para Knative/Kubernetes
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });

    it('should be accessible without tenant header', async () => {
      // Health check NO debe requerir tenant header
      const response = await request(app.getHttpServer())
        .get('/health')
        // No seteamos TENANT_HEADER
        .expect(200);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('Health Check Reliability', () => {
    it('should return consistent results on multiple calls', async () => {
      const responses = await Promise.all([
        request(app.getHttpServer()).get('/health'),
        request(app.getHttpServer()).get('/health'),
        request(app.getHttpServer()).get('/health'),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('checks');
      }

      // Todos deben reportar el mismo estado de DB
      const dbStatuses = responses.map((r: { body: { checks: { database: string } } }) => r.body.checks.database);
      expect(new Set(dbStatuses).size).toBe(1); // Todos iguales
    });

    it('should have recent timestamp', async () => {
      const beforeRequest = Date.now();

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      const afterRequest = Date.now();
      const responseTimestamp = new Date(response.body.timestamp).getTime();

      // El timestamp debe estar entre before y after
      expect(responseTimestamp).toBeGreaterThanOrEqual(beforeRequest - 1000); // 1s tolerancia
      expect(responseTimestamp).toBeLessThanOrEqual(afterRequest + 1000);
    });
  });

  describe('Health Check Response Headers', () => {
    it('should return appropriate content-type', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.headers['content-type']).toContain('application/json');
    });
  });
});
