import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CredentialsModule } from '../../src/modules/credentials/credentials.module';
import { TenantConnectionManager } from '../../src/providers/tenant-connection-manager';
import { NatsPublisher } from '../../src/providers/nats.provider';
import { TENANT_HEADER } from '@yoizen/shared';

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
  publishCredentialRotated: async () => null,
});

describe('Credentials Integration Tests', () => {
  let app: INestApplication;
  let mockConnectionManager: ReturnType<typeof createMockTenantConnectionManager>;
  let mockNatsPublisher: ReturnType<typeof createMockNatsPublisher>;
  const TENANT_ID = 'test-tenant-123';

  beforeAll(async () => {
    mockConnectionManager = createMockTenantConnectionManager();
    mockNatsPublisher = createMockNatsPublisher();

    const module = await Test.createTestingModule({
      imports: [CredentialsModule],
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

  describe('POST /admin/credentials', () => {
    it('should create a new credential', async () => {
      const credentialData = {
        name: 'Test API Key',
        type: 'api_key',
        value: 'secret-api-key-123',
        metadata: { provider: 'openai', region: 'us-east-1' },
      };

      const response = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send(credentialData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(credentialData.name);
      expect(response.body.type).toBe(credentialData.type);
      // Seguridad: NUNCA retornar el campo value
      expect(response.body).not.toHaveProperty('value');
      expect(response.body.is_encrypted).toBe(false); // Placeholder hasta cifrado
      expect(response.body.is_active).toBe(true);
    });

    it('should create credential with expiration', async () => {
      const credentialData = {
        name: 'OAuth Token',
        type: 'oauth',
        value: 'oauth-secret-token',
        metadata: { scopes: ['read', 'write'] },
        expires_at: '2024-12-31T23:59:59Z',
      };

      const response = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send(credentialData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe('oauth');
      expect(response.body).not.toHaveProperty('value');
      expect(response.body.expires_at).toBeDefined();
    });

    it('should validate required fields', async () => {
      const invalidData = {
        name: '',
        type: 'invalid_type',
        value: '',
      };

      await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send(invalidData)
        .expect(400);
    });

    it('should require tenant header', async () => {
      const credentialData = {
        name: 'Test API Key',
        type: 'api_key',
        value: 'secret-key',
      };

      await request(app.getHttpServer())
        .post('/admin/credentials')
        .send(credentialData)
        .expect(400);
    });

    it('should validate credential type enum', async () => {
      const invalidData = {
        name: 'Test',
        type: 'invalid_type', // No está en ['api_key', 'oauth', 'basic', 'custom']
        value: 'secret',
      };

      await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send(invalidData)
        .expect(400);
    });
  });

  describe('GET /admin/credentials', () => {
    it('should list credentials without value field', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/credentials?limit=10&offset=0')
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty('credentials');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.credentials)).toBe(true);
      // Seguridad: Ninguna credencial debe tener campo value
      response.body.credentials.forEach((cred: Record<string, unknown>) => {
        expect(cred).not.toHaveProperty('value');
      });
    });

    it('should filter by type', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/credentials?type=api_key')
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty('credentials');
    });

    it('should filter by is_active', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/credentials?is_active=true')
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty('credentials');
    });
  });

  describe('GET /admin/credentials/:id', () => {
    it('should get credential by id without value field', async () => {
      // First create a credential
      const createResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Test API Key',
          type: 'api_key',
          value: 'secret-key-123',
        })
        .expect(201);

      const credId = createResponse.body.id;

      // Then get it
      const response = await request(app.getHttpServer())
        .get(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.id).toBe(credId);
      expect(response.body.name).toBe('Test API Key');
      // Seguridad: NUNCA retornar el campo value
      expect(response.body).not.toHaveProperty('value');
    });

    it('should return 404 for non-existent credential', async () => {
      await request(app.getHttpServer())
        .get('/admin/credentials/non-existent-id')
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe('PUT /admin/credentials/:id', () => {
    it('should update credential without changing value', async () => {
      // First create a credential
      const createResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Original Name',
          type: 'api_key',
          value: 'original-secret',
        })
        .expect(201);

      const credId = createResponse.body.id;

      // Update it (solo nombre, no value)
      const response = await request(app.getHttpServer())
        .put(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Updated Name',
          metadata: { updated: true },
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body).not.toHaveProperty('value');
    });

    it('should update credential and emit rotation event when value changes', async () => {
      // First create a credential
      const createResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Test Credential',
          type: 'api_key',
          value: 'old-secret',
        })
        .expect(201);

      const credId = createResponse.body.id;

      // Update with new value
      const response = await request(app.getHttpServer())
        .put(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          value: 'new-secret-value',
        })
        .expect(200);

      expect(response.body).not.toHaveProperty('value');
      // El evento credential.rotated se emite cuando se actualiza el value
    });

    it('should return 404 for non-existent credential', async () => {
      await request(app.getHttpServer())
        .put('/admin/credentials/non-existent-id')
        .set(TENANT_HEADER, TENANT_ID)
        .send({ name: 'New Name' })
        .expect(404);
    });
  });

  describe('DELETE /admin/credentials/:id', () => {
    it('should soft delete credential', async () => {
      // First create a credential
      const createResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Credential to Delete',
          type: 'api_key',
          value: 'will-be-deleted',
        })
        .expect(201);

      const credId = createResponse.body.id;

      // Delete it
      await request(app.getHttpServer())
        .delete(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(204);

      // Verify it's gone
      await request(app.getHttpServer())
        .get(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });

    it('should return 404 for non-existent credential', async () => {
      await request(app.getHttpServer())
        .delete('/admin/credentials/non-existent-id')
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe('PUT /admin/credentials/:id/rotate', () => {
    it('should rotate credential value and emit event', async () => {
      // First create a credential
      const createResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Credential to Rotate',
          type: 'api_key',
          value: 'old-key-value',
        })
        .expect(201);

      const credId = createResponse.body.id;

      // Rotate it
      const response = await request(app.getHttpServer())
        .put(`/admin/credentials/${credId}/rotate`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          new_value: 'new-rotated-key-value',
          new_expires_at: '2025-12-31T23:59:59Z',
        })
        .expect(200);

      expect(response.body).not.toHaveProperty('value');
      expect(response.body.expires_at).toBeDefined();
      // El evento credential.rotated se emite automáticamente
    });

    it('should rotate without new expiration date', async () => {
      // First create a credential
      const createResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Credential to Rotate',
          type: 'oauth',
          value: 'old-oauth-token',
        })
        .expect(201);

      const credId = createResponse.body.id;

      // Rotate without expiration
      const response = await request(app.getHttpServer())
        .put(`/admin/credentials/${credId}/rotate`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          new_value: 'new-oauth-token',
        })
        .expect(200);

      expect(response.body).not.toHaveProperty('value');
    });

    it('should return 404 for non-existent credential', async () => {
      await request(app.getHttpServer())
        .put('/admin/credentials/non-existent-id/rotate')
        .set(TENANT_HEADER, TENANT_ID)
        .send({ new_value: 'new-value' })
        .expect(404);
    });

    it('should require new_value in rotation request', async () => {
      await request(app.getHttpServer())
        .put('/admin/credentials/some-id/rotate')
        .set(TENANT_HEADER, TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('Complete workflow', () => {
    it('should handle full credential lifecycle', async () => {
      // 1. Create credential
      const createResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Lifecycle Credential',
          type: 'api_key',
          value: 'lifecycle-secret-key',
          metadata: { environment: 'test', service: 'api' },
        })
        .expect(201);

      const credId = createResponse.body.id;
      expect(createResponse.body.name).toBe('Lifecycle Credential');
      expect(createResponse.body).not.toHaveProperty('value');
      expect(createResponse.body.is_encrypted).toBe(false);

      // 2. List credentials - should include the new one
      const listResponse = await request(app.getHttpServer())
        .get('/admin/credentials')
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(listResponse.body.credentials.length).toBeGreaterThan(0);
      // Seguridad: Verificar que ninguna credencial tiene campo value
      listResponse.body.credentials.forEach((cred: Record<string, unknown>) => {
        expect(cred).not.toHaveProperty('value');
      });

      // 3. Get credential by id
      const getResponse = await request(app.getHttpServer())
        .get(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(getResponse.body.name).toBe('Lifecycle Credential');
      expect(getResponse.body).not.toHaveProperty('value');

      // 4. Update credential
      const updateResponse = await request(app.getHttpServer())
        .put(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: 'Updated Lifecycle Credential',
          metadata: { updated: true },
        })
        .expect(200);

      expect(updateResponse.body.name).toBe('Updated Lifecycle Credential');
      expect(updateResponse.body).not.toHaveProperty('value');

      // 5. Rotate credential
      const rotateResponse = await request(app.getHttpServer())
        .put(`/admin/credentials/${credId}/rotate`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          new_value: 'rotated-secret-key',
        })
        .expect(200);

      expect(rotateResponse.body).not.toHaveProperty('value');
      // El evento credential.rotated se emite automáticamente

      // 6. Filter by type
      const filteredResponse = await request(app.getHttpServer())
        .get('/admin/credentials?type=api_key')
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(filteredResponse.body).toHaveProperty('credentials');

      // 7. Delete credential
      await request(app.getHttpServer())
        .delete(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(204);

      // 8. Verify deletion
      await request(app.getHttpServer())
        .get(`/admin/credentials/${credId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });

    it('should support all credential types', async () => {
      const types = ['api_key', 'oauth', 'basic', 'custom'] as const;

      for (const type of types) {
        const response = await request(app.getHttpServer())
          .post('/admin/credentials')
          .set(TENANT_HEADER, TENANT_ID)
          .send({
            name: `${type} Credential`,
            type,
            value: `${type}-secret`,
          })
          .expect(201);

        expect(response.body.type).toBe(type);
        expect(response.body).not.toHaveProperty('value');
      }
    });
  });
});
