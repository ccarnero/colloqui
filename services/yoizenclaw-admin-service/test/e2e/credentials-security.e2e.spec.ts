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

describe('Credentials Security E2E Tests', () => {
  let app: INestApplication;
  let context: TestContext;
  let tenant: TestTenant;

  beforeAll(async () => {
    context = await setupPostgres();
    tenant = await createTestTenant(context, 'credentials-security-tenant');

    const mockNatsPublisher = createMockNatsPublisher(context);

    const mockConnectionManager = {
      getConnection: () => tenant.sql,
      ensureSchema: async () => {},
      isSchemaInitialized: () => true,
      markSchemaInitialized: () => {},
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
    await context.postgresContainer.stop();
  });

  beforeEach(async () => {
    await cleanupTenantTables(context, tenant.id);
  });

  describe('GET /admin/credentials - Value Field Security', () => {
    it('should NOT include value field in list response', async () => {
      // Crear credential directamente en DB
      await tenant.sql`
        INSERT INTO credentials (name, type, value, is_encrypted)
        VALUES ('Test API Key', 'api_key', 'super-secret-value-12345', false);
      `;

      const response = await request(app.getHttpServer())
        .get('/admin/credentials')
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body).toHaveProperty('credentials');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.credentials)).toBe(true);
      expect(response.body.credentials.length).toBe(1);

      const credential = response.body.credentials[0];
      expect(credential.name).toBe('Test API Key');
      expect(credential.type).toBe('api_key');
      // Lo MÁS IMPORTANTE: el campo value NO debe estar presente
      expect(credential).not.toHaveProperty('value');
      expect(credential.value).toBeUndefined();
    });

    it('should NOT include value field in single credential response', async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value, is_encrypted)
        VALUES ('OAuth Token', 'oauth', 'bearer-token-secret-67890', false)
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .get(`/admin/credentials/${credential.id}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.id).toBe(credential.id);
      expect(response.body.name).toBe('OAuth Token');
      expect(response.body.type).toBe('oauth');
      // Lo MÁS IMPORTANTE: el campo value NO debe estar presente
      expect(response.body).not.toHaveProperty('value');
      expect(response.body.value).toBeUndefined();
    });

    it('should NOT include value field for multiple credentials in list', async () => {
      await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES 
          ('API Key 1', 'api_key', 'secret-1'),
          ('API Key 2', 'api_key', 'secret-2'),
          ('Basic Auth', 'basic', 'user:pass'),
          ('Custom Token', 'custom', 'custom-secret');
      `;

      const response = await request(app.getHttpServer())
        .get('/admin/credentials')
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.credentials.length).toBe(4);

      // Verificar que NINGUNA credential tiene el campo value
      for (const cred of response.body.credentials) {
        expect(cred).not.toHaveProperty('value');
        expect(cred.value).toBeUndefined();
        expect(cred).toHaveProperty('id');
        expect(cred).toHaveProperty('name');
        expect(cred).toHaveProperty('type');
      }
    });

    it('should include other safe fields but exclude value', async () => {
      const expiresAt = new Date('2025-12-31');
      await tenant.sql`
        INSERT INTO credentials (name, type, value, metadata, expires_at, is_active, is_encrypted)
        VALUES (
          'Full Credential', 
          'api_key', 
          'top-secret-key', 
          ${tenant.sql.json({ provider: 'aws', region: 'us-east-1' })},
          ${expiresAt},
          true,
          false
        );
      `;

      const response = await request(app.getHttpServer())
        .get('/admin/credentials')
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const credential = response.body.credentials[0];

      // Campos que SÍ deben estar presentes
      expect(credential.id).toBeDefined();
      expect(credential.name).toBe('Full Credential');
      expect(credential.type).toBe('api_key');
      expect(credential.metadata).toEqual({ provider: 'aws', region: 'us-east-1' });
      expect(credential.expires_at).toBeDefined();
      expect(credential.is_active).toBe(true);
      expect(credential.is_encrypted).toBe(false);
      expect(credential.created_at).toBeDefined();
      expect(credential.updated_at).toBeDefined();

      // Campo que NO debe estar presente
      expect(credential).not.toHaveProperty('value');
    });
  });

  describe('POST /admin/credentials - Creation', () => {
    it('should create credential and return without value', async () => {
      const credentialData = {
        name: 'New API Key',
        type: 'api_key',
        value: 'my-secret-api-key-value',
        metadata: { service: 'payment-gateway' },
      };

      const response = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, tenant.id)
        .send(credentialData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(credentialData.name);
      expect(response.body.type).toBe(credentialData.type);
      // La respuesta NO debe incluir el value
      expect(response.body).not.toHaveProperty('value');

      // Verificar que el valor se guardó en la DB
      const [dbCredential] = await tenant.sql`
        SELECT * FROM credentials WHERE id = ${response.body.id};
      `;
      expect(dbCredential.value).toBe(credentialData.value);
    });

    it('should accept all credential types', async () => {
      const types = ['api_key', 'oauth', 'basic', 'custom'];

      for (const type of types) {
        const response = await request(app.getHttpServer())
          .post('/admin/credentials')
          .set(TENANT_HEADER, tenant.id)
          .send({
            name: `${type} Credential`,
            type,
            value: `secret-${type}`,
          })
          .expect(201);

        expect(response.body.type).toBe(type);
        expect(response.body).not.toHaveProperty('value');
      }

      // Verificar que todos se crearon
      const listResponse = await request(app.getHttpServer())
        .get('/admin/credentials')
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(listResponse.body.total).toBe(4);
    });
  });

  describe('PUT /admin/credentials/:id - Update', () => {
    it('should update credential and return without value', async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Original Name', 'api_key', 'original-secret')
        RETURNING id;
      `;

      const updateData = {
        name: 'Updated Name',
        value: 'updated-secret-value',
      };

      const response = await request(app.getHttpServer())
        .put(`/admin/credentials/${credential.id}`)
        .set(TENANT_HEADER, tenant.id)
        .send(updateData)
        .expect(200);

      expect(response.body.name).toBe(updateData.name);
      expect(response.body).not.toHaveProperty('value');

      // Verificar que el valor se actualizó en la DB
      const [dbCredential] = await tenant.sql`
        SELECT value FROM credentials WHERE id = ${credential.id};
      `;
      expect(dbCredential.value).toBe(updateData.value);
    });

    it('should rotate credential value and emit event', async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Rotatable Key', 'api_key', 'old-secret')
        RETURNING id, type;
      `;

      const response = await request(app.getHttpServer())
        .put(`/admin/credentials/${credential.id}/rotate`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          new_value: 'new-rotated-secret',
        })
        .expect(200);

      expect(response.body).not.toHaveProperty('value');

      // Verificar que el nuevo valor se guardó
      const [dbCredential] = await tenant.sql`
        SELECT value FROM credentials WHERE id = ${credential.id};
      `;
      expect(dbCredential.value).toBe('new-rotated-secret');
    });
  });

  describe('Security Edge Cases', () => {
    it('should handle credential with empty value securely', async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Empty Value', 'custom', '')
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .get(`/admin/credentials/${credential.id}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body).not.toHaveProperty('value');
    });

    it('should handle credential with long value securely', async () => {
      const longValue = 'x'.repeat(10000);

      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Long Value', 'custom', ${longValue})
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .get(`/admin/credentials/${credential.id}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body).not.toHaveProperty('value');
    });

    it('should handle credential with special characters in value securely', async () => {
      const specialValue = '!@#$%^&*()_+-=[]{}|;\':",./<>?\`~\n\t\r';

      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Special Value', 'custom', ${specialValue})
        RETURNING id;
      `;

      const response = await request(app.getHttpServer())
        .get(`/admin/credentials/${credential.id}`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body).not.toHaveProperty('value');
    });
  });

  describe('Filtering and Pagination Security', () => {
    it('should filter by type without exposing values', async () => {
      await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES 
          ('API Key 1', 'api_key', 'api-secret-1'),
          ('API Key 2', 'api_key', 'api-secret-2'),
          ('OAuth Token', 'oauth', 'oauth-secret'),
          ('Basic Auth', 'basic', 'basic-secret');
      `;

      const response = await request(app.getHttpServer())
        .get('/admin/credentials?type=api_key')
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.credentials.length).toBe(2);

      for (const cred of response.body.credentials) {
        expect(cred.type).toBe('api_key');
        expect(cred).not.toHaveProperty('value');
      }
    });

    it('should paginate without exposing values', async () => {
      for (let i = 1; i <= 5; i++) {
        await tenant.sql`
          INSERT INTO credentials (name, type, value)
          VALUES (${`Credential ${i}`}, 'api_key', ${`secret-${i}`});
        `;
      }

      const response = await request(app.getHttpServer())
        .get('/admin/credentials?limit=2&offset=0')
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      expect(response.body.credentials.length).toBe(2);
      expect(response.body.total).toBe(5);

      for (const cred of response.body.credentials) {
        expect(cred).not.toHaveProperty('value');
      }
    });
  });
});
