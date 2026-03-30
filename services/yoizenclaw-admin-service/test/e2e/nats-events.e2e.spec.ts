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
  clearNatsEvents,
  getLastEventByType,
  getEventsByType,
  type TestContext,
  type TestTenant,
} from './setup';

describe('NATS Events E2E Tests', () => {
  let app: INestApplication;
  let context: TestContext;
  let tenant: TestTenant;

  beforeAll(async () => {
    context = await setupPostgres();
    tenant = await createTestTenant(context, 'nats-events-tenant');

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
    clearNatsEvents(context);
  });

  describe('Event Structure Validation', () => {
    it('should emit event with correct structure on agent publish', async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Event Test Agent', 'Prompt', 'draft')
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, 'agent.published');
      expect(event).toBeDefined();

      // Verificar estructura del evento
      expect(event).toHaveProperty('subject');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('payload');
      expect(event).toHaveProperty('metadata');

      // Verificar campos requeridos en payload
      expect(event!.payload).toHaveProperty('agentId');
      expect(event!.payload).toHaveProperty('name');
      expect(event!.payload).toHaveProperty('publishedAt');
      expect(event!.payload).toHaveProperty('status');

      // Verificar metadata
      expect(event!.metadata).toHaveProperty('tenantId');
      expect(event!.metadata).toHaveProperty('timestamp');
      expect(event!.metadata).toHaveProperty('source');

      // Verificar valores
      expect(event!.type).toBe('agent.published');
      expect(event!.subject).toBe('events.agent.published');
      expect(event!.payload.agentId).toBe(agent.id);
      expect(event!.metadata.tenantId).toBe(tenant.id);
      expect(event!.metadata.source).toBe('admin-service');
      expect(typeof event!.metadata.timestamp).toBe('number');
    });

    it('should emit event with correct structure on agent unpublish', async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status, published_at)
        VALUES ('Unpublish Test Agent', 'Prompt', 'published', NOW())
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/unpublish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, 'agent.unpublished');
      expect(event).toBeDefined();

      // Verificar estructura
      expect(event!.payload).toHaveProperty('agentId');
      expect(event!.payload).toHaveProperty('name');
      expect(event!.payload).toHaveProperty('unpublishedAt');
      expect(event!.payload).toHaveProperty('status');

      expect(event!.metadata).toHaveProperty('tenantId');
      expect(event!.metadata).toHaveProperty('timestamp');
      expect(event!.metadata).toHaveProperty('source');

      expect(event!.type).toBe('agent.unpublished');
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });
  });

  describe('Agent Publish/Unpublish Events', () => {
    it('should emit agent.published event when publishing agent', async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status)
        VALUES ('Publish Event Agent', 'Prompt', 'draft')
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, 'agent.published');
      expect(event).toBeDefined();
      expect(event!.type).toBe('agent.published');
      expect(event!.payload.agentId).toBe(agent.id);
      expect(event!.payload.name).toBe('Publish Event Agent');
      expect(event!.payload.status).toBe('published');
    });

    it('should emit agent.unpublished event when unpublishing agent', async () => {
      const [agent] = await tenant.sql`
        INSERT INTO agents (name, system_prompt, status, published_at)
        VALUES ('Unpublish Event Agent', 'Prompt', 'published', NOW())
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .post(`/admin/agents/${agent.id}/unpublish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      const event = getLastEventByType(context, 'agent.unpublished');
      expect(event).toBeDefined();
      expect(event!.type).toBe('agent.unpublished');
      expect(event!.payload.agentId).toBe(agent.id);
      expect(event!.payload.status).toBe('draft');
    });

    it('should emit both events for publish-unpublish cycle', async () => {
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

      const publishEvents = getEventsByType(context, 'agent.published');
      const unpublishEvents = getEventsByType(context, 'agent.unpublished');

      expect(publishEvents.length).toBe(1);
      expect(unpublishEvents.length).toBe(1);

      expect(publishEvents[0].payload.agentId).toBe(agent.id);
      expect(unpublishEvents[0].payload.agentId).toBe(agent.id);
    });
  });

  describe('Channel Config Changed Events', () => {
    it('should emit channel.config.changed event when updating channel', async () => {
      // Crear channel primero
      const [channel] = await tenant.sql`
        INSERT INTO channels (name, type, config)
        VALUES ('Test Channel', 'webchat', ${tenant.sql.json({ greeting: 'Hello' })})  
        RETURNING id;
      `;

      // Actualizar channel
      await request(app.getHttpServer())
        .put(`/admin/channels/${channel.id}`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: 'Updated Channel',
          config: { greeting: 'Updated Hello' },
        })
        .expect(200);

      const event = getLastEventByType(context, 'channel.config.changed');
      expect(event).toBeDefined();
      expect(event!.type).toBe('channel.config.changed');
      expect(event!.payload.channelId).toBe(channel.id);
      expect(event!.payload.channelType).toBe('webchat');
      expect(event!.payload).toHaveProperty('changes');
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });

    it('should include correct change data in channel event', async () => {
      const [channel] = await tenant.sql`
        INSERT INTO channels (name, type, config)
        VALUES ('Config Channel', 'whatsapp', ${tenant.sql.json({})})
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .put(`/admin/channels/${channel.id}`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          config: { phoneNumber: '+1234567890', webhook: 'https://example.com' },
        })
        .expect(200);

      const event = getLastEventByType(context, 'channel.config.changed');
      expect(event!.payload.changes).toBeDefined();
      expect(event!.payload).toHaveProperty('changedAt');
    });
  });

  describe('Credential Rotated Events', () => {
    it('should emit credential.rotated event when rotating credential', async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Rotatable Credential', 'api_key', 'old-value')
        RETURNING id, type;
      `;

      await request(app.getHttpServer())
        .put(`/admin/credentials/${credential.id}/rotate`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          new_value: 'new-rotated-value',
        })
        .expect(200);

      const event = getLastEventByType(context, 'credential.rotated');
      expect(event).toBeDefined();
      expect(event!.type).toBe('credential.rotated');
      expect(event!.payload.credentialId).toBe(credential.id);
      expect(event!.payload.type).toBe('api_key');
      expect(event!.payload).toHaveProperty('rotatedAt');
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });

    it('should emit credential.rotated event when updating credential value', async () => {
      const [credential] = await tenant.sql`
        INSERT INTO credentials (name, type, value)
        VALUES ('Updatable Credential', 'oauth', 'original-token')
        RETURNING id;
      `;

      await request(app.getHttpServer())
        .put(`/admin/credentials/${credential.id}`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          value: 'updated-token-value',
        })
        .expect(200);

      const event = getLastEventByType(context, 'credential.rotated');
      expect(event).toBeDefined();
      expect(event!.type).toBe('credential.rotated');
    });
  });

  describe('Runtime Config Sync Events', () => {
    it('should emit runtime.config.sync event when deploying config files', async () => {
      // Crear algunos config files
      await tenant.sql`
        INSERT INTO config_files (name, path, content, format)
        VALUES 
          ('App Config', '/config/app.yaml', 'key: value', 'yaml'),
          ('API Config', '/config/api.json', '{"key": "value"}', 'json');
      `;

      await request(app.getHttpServer())
        .post('/admin/config-files/deploy')
        .set(TENANT_HEADER, tenant.id)
        .send({})
        .expect(200);

      const event = getLastEventByType(context, 'runtime.config.sync');
      expect(event).toBeDefined();
      expect(event!.type).toBe('runtime.config.sync');
      expect(event!.payload).toHaveProperty('files');
      expect(event!.payload).toHaveProperty('deletePaths');
      expect(event!.payload).toHaveProperty('syncedAt');
      expect(Array.isArray(event!.payload.files)).toBe(true);
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });
  });

  describe('Job Trigger Events', () => {
    it('should emit job.trigger event when triggering job', async () => {
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

      const triggerPayload = { customData: 'test-value', priority: 1 };

      await request(app.getHttpServer())
        .post(`/admin/jobs/${job.id}/trigger`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          event_payload: triggerPayload,
        })
        .expect(201);

      const event = getLastEventByType(context, 'job.trigger');
      expect(event).toBeDefined();
      expect(event!.type).toBe('job.trigger');
      expect(event!.payload.jobId).toBe(job.id);
      expect(event!.payload).toHaveProperty('executionId');
      expect(event!.payload.eventPayload).toEqual(triggerPayload);
      expect(event!.payload).toHaveProperty('triggeredAt');
      expect(event!.metadata.tenantId).toBe(tenant.id);
    });

    it('should emit job.trigger event when running job manually', async () => {
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

      const event = getLastEventByType(context, 'job.trigger');
      expect(event).toBeDefined();
      expect(event!.type).toBe('job.trigger');
      expect(event!.payload.jobId).toBe(job.id);
    });
  });

  describe('Multiple Event Scenarios', () => {
    it('should emit multiple events during complex workflow', async () => {
      // 1. Crear agent
      const createResponse = await request(app.getHttpServer())
        .post('/admin/agents')
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: 'Complex Workflow Agent',
          system_prompt: 'Prompt',
        })
        .expect(201);

      const agentId = createResponse.body.id;
      const initialEventCount = context.natsEvents.length;

      // 2. Publicar agent (evento 1)
      await request(app.getHttpServer())
        .post(`/admin/agents/${agentId}/publish`)
        .set(TENANT_HEADER, tenant.id)
        .expect(200);

      // 3. Crear channel
      const channelResponse = await request(app.getHttpServer())
        .post('/admin/channels')
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: 'Test Channel',
          type: 'webchat',
          config: {},
        })
        .expect(201);

      const channelId = channelResponse.body.id;

      // 4. Actualizar channel (evento 2)
      await request(app.getHttpServer())
        .put(`/admin/channels/${channelId}`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          config: { updated: true },
        })
        .expect(200);

      // 5. Crear credential
      const credentialResponse = await request(app.getHttpServer())
        .post('/admin/credentials')
        .set(TENANT_HEADER, tenant.id)
        .send({
          name: 'Test Credential',
          type: 'api_key',
          value: 'secret',
        })
        .expect(201);

      const credentialId = credentialResponse.body.id;

      // 6. Rotar credential (evento 3)
      await request(app.getHttpServer())
        .put(`/admin/credentials/${credentialId}/rotate`)
        .set(TENANT_HEADER, tenant.id)
        .send({
          new_value: 'new-secret',
        })
        .expect(200);

      // Verificar que se emitieron todos los eventos esperados
      const publishEvents = getEventsByType(context, 'agent.published');
      const channelEvents = getEventsByType(context, 'channel.config.changed');
      const rotateEvents = getEventsByType(context, 'credential.rotated');

      expect(publishEvents.length).toBeGreaterThanOrEqual(1);
      expect(channelEvents.length).toBeGreaterThanOrEqual(1);
      expect(rotateEvents.length).toBeGreaterThanOrEqual(1);

      // Verificar que cada evento tiene la estructura correcta
      for (const event of context.natsEvents.slice(initialEventCount)) {
        expect(event).toHaveProperty('subject');
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('payload');
        expect(event).toHaveProperty('metadata');
        expect(event.metadata).toHaveProperty('tenantId');
        expect(event.metadata).toHaveProperty('timestamp');
        expect(event.metadata).toHaveProperty('source');
      }
    });
  });
});
