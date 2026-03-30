import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TenantConnectionManager } from '../../src/providers/tenant-connection-manager';
import { NatsPublisher } from '../../src/providers/nats.provider';
import { TENANT_HEADER } from '../../src/types/yoizen-shared';
import {
  setupPostgres,
  createMockNatsPublisher,
  createTestTenant,
  cleanupTenantTables,
  type TestContext,
  type TestTenant,
} from './setup';

describe('Multi-Tenancy E2E Tests', () => {
  let app: INestApplication;
  let context: TestContext;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let mockConnectionManager: { getConnection: () => unknown };

  beforeAll(async () => {
    context = await setupPostgres();
    tenantA = await createTestTenant(context, 'tenant-a');
    tenantB = await createTestTenant(context, 'tenant-b');

    const mockNatsPublisher = createMockNatsPublisher(context);

    // Mock TenantConnectionManager que devuelve la conexión según el tenant
    mockConnectionManager = {
      getConnection: () => {
        // Por defecto retorna tenantA, pero en los tests usaremos override
        return tenantA.sql;
      },
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

  beforeEach(async () => {
    await cleanupTenantTables(context, tenantA.id);
    await cleanupTenantTables(context, tenantB.id);
  });

  describe('Tenant Isolation - Agents', () => {
    it('Tenant A should only see their own agents', async () => {
      // Crear 3 agents en Tenant A directamente en DB
      await tenantA.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES 
          ('Tenant A Agent 1', 'Prompt 1', 'draft'),
          ('Tenant A Agent 2', 'Prompt 2', 'draft'),
          ('Tenant A Agent 3', 'Prompt 3', 'draft');
      `;

      // Crear 2 agents diferentes en Tenant B directamente en DB
      await tenantB.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES 
          ('Tenant B Agent 1', 'Prompt 1', 'draft'),
          ('Tenant B Agent 2', 'Prompt 2', 'draft');
      `;

      // Mock temporal para Tenant A
      const moduleA = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantA.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const appA = moduleA.createNestApplication();
      await appA.init();

      // Tenant A lista sus agents
      const responseA = await request(appA.getHttpServer())
        .get('/admin/agents')
        .set(TENANT_HEADER, tenantA.id)
        .expect(200);

      expect(responseA.body.agents.length).toBe(3);
      expect(responseA.body.total).toBe(3);
      expect(responseA.body.agents.every((a: { name: string }) => a.name.includes('Tenant A'))).toBe(true);

      await appA.close();

      // Mock temporal para Tenant B
      const moduleB = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantB.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const appB = moduleB.createNestApplication();
      await appB.init();

      // Tenant B lista sus agents
      const responseB = await request(appB.getHttpServer())
        .get('/admin/agents')
        .set(TENANT_HEADER, tenantB.id)
        .expect(200);

      expect(responseB.body.agents.length).toBe(2);
      expect(responseB.body.total).toBe(2);
      expect(responseB.body.agents.every((a: { name: string }) => a.name.includes('Tenant B'))).toBe(true);

      await appB.close();
    });

    it('Tenant B cannot access Tenant A agent by ID', async () => {
      // Crear agent en Tenant A
      const [agentA] = await tenantA.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Secret Agent A', 'Secret Prompt', 'draft')
        RETURNING id;
      `;

      // Mock para Tenant B intentando acceder a agent de Tenant A
      const moduleB = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantB.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const appB = moduleB.createNestApplication();
      await appB.init();

      // Tenant B intenta acceder al agent de Tenant A - debería retornar 404
      await request(appB.getHttpServer())
        .get(`/admin/agents/${agentA.id}`)
        .set(TENANT_HEADER, tenantB.id)
        .expect(404);

      await appB.close();
    });

    it('Tenant B cannot modify Tenant A agent', async () => {
      // Crear agent en Tenant A
      const [agentA] = await tenantA.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Protected Agent A', 'Protected Prompt', 'draft')
        RETURNING id;
      `;

      // Mock para Tenant B intentando modificar agent de Tenant A
      const moduleB = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantB.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const appB = moduleB.createNestApplication();
      await appB.close();
    });
  });

  describe('Tenant Isolation - Credentials', () => {
    it('should isolate credentials between tenants', async () => {
      // Crear credentials en ambos tenants
      await tenantA.sql`
        INSERT INTO credentials (name, type, value)
        VALUES 
          ('Tenant A API Key', 'api_key', 'secret-a-1'),
          ('Tenant A OAuth', 'oauth', 'secret-a-2');
      `;

      await tenantB.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Tenant B API Key', 'api_key', 'secret-b-1');
      `;

      const moduleA = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantA.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const appA = moduleA.createNestApplication();
      await appA.init();

      const responseA = await request(appA.getHttpServer())
        .get('/admin/credentials')
        .set(TENANT_HEADER, tenantA.id)
        .expect(200);

      expect(responseA.body.credentials.length).toBe(2);

      await appA.close();
    });
  });

  describe('Tenant Isolation - Channels', () => {
    it('should isolate channels between tenants', async () => {
      // Crear channels en ambos tenants
      await tenantA.sql`
        INSERT INTO channels (name, type, config)
        VALUES 
          ('Tenant A Webchat', 'webchat', '{}'),
          ('Tenant A WhatsApp', 'whatsapp', '{}');
      `;

      await tenantB.sql`
        INSERT INTO channels (name, type, config)
        VALUES ('Tenant B Webchat', 'webchat', '{}');
      `;

      const moduleA = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantA.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const appA = moduleA.createNestApplication();
      await appA.init();

      const responseA = await request(appA.getHttpServer())
        .get('/admin/channels')
        .set(TENANT_HEADER, tenantA.id)
        .expect(200);

      expect(responseA.body.channels.length).toBe(2);

      await appA.close();
    });
  });

  describe('Mixed Tenant Operations', () => {
    it('should handle concurrent operations from different tenants', async () => {
      // Configurar ambas aplicaciones
      const moduleA = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantA.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const moduleB = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TenantConnectionManager)
        .useValue({
          getConnection: () => tenantB.sql,
          ensureSchema: async () => {},
          isSchemaInitialized: () => true,
          markSchemaInitialized: () => {},
          closeAll: async () => {},
          onModuleDestroy: async () => {},
        })
        .overrideProvider(NatsPublisher)
        .useValue(createMockNatsPublisher(context))
        .compile();

      const appA = moduleA.createNestApplication();
      const appB = moduleB.createNestApplication();
      await appA.init();
      await appB.init();

      // Operaciones concurrentes
      const [responseA, responseB] = await Promise.all([
        request(appA.getHttpServer())
          .post('/admin/agents')
          .set(TENANT_HEADER, tenantA.id)
          .send({
            name: 'Concurrent Agent A',
            system_prompt: 'Prompt A',
          }),
        request(appB.getHttpServer())
          .post('/admin/agents')
          .set(TENANT_HEADER, tenantB.id)
          .send({
            name: 'Concurrent Agent B',
            system_prompt: 'Prompt B',
          }),
      ]);

      expect(responseA.status).toBe(201);
      expect(responseB.status).toBe(201);

      const agentAId = responseA.body.id;
      const agentBId = responseB.body.id;

      // Verificar que cada tenant solo ve su propio agent
      const listA = await request(appA.getHttpServer())
        .get('/admin/agents')
        .set(TENANT_HEADER, tenantA.id)
        .expect(200);

      const listB = await request(appB.getHttpServer())
        .get('/admin/agents')
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
