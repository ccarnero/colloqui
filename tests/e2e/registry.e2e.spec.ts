import { describe, it, expect, afterAll } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, httpPatch, httpDelete, poll } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

const SERVICE_NAME = `e2e-svc-${Date.now().toString(36)}`;
const createdServiceIds: string[] = [];
const createdRouteIds: { serviceId: string; routeId: string }[] = [];

afterAll(async () => {
  const h = await authHeaders();
  for (const { serviceId, routeId } of createdRouteIds) {
    await httpDelete(`${GW}/registry/services/${serviceId}/routes/${routeId}`, { headers: h });
  }
  for (const id of createdServiceIds) {
    await httpDelete(`${GW}/registry/services/${id}`, { headers: h });
  }
});

describe('E2E: registry-service', () => {
  let serviceId: string;

  describe('service CRUD', () => {
    it('should register a Knative service', async () => {
      const h = await authHeaders();
      const { status, body } = await httpPost<{ id: string; name: string; image: string }>(
        `${GW}/registry/services`,
        {
          name: SERVICE_NAME,
          image: 'gcr.io/knative-samples/helloworld-go:latest',
          port: 8080,
          minScale: 0,
          maxScale: 1,
        },
        { headers: h },
      );

      expect(status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.name).toBe(SERVICE_NAME);
      serviceId = body.id;
      createdServiceIds.push(serviceId);
    });

    it('should list services', async () => {
      const h = await authHeaders();
      const { status, body } = await httpGet<unknown[]>(`${GW}/registry/services`, {
        headers: h,
      });

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should get a specific service', async () => {
      if (!serviceId) return;
      const h = await authHeaders();
      const { status, body } = await httpGet<{ id: string; name: string }>(
        `${GW}/registry/services/${serviceId}`,
        { headers: h },
      );

      expect(status).toBe(200);
      expect(body.id).toBe(serviceId);
      expect(body.name).toBe(SERVICE_NAME);
    });

    it('should update a service', async () => {
      if (!serviceId) return;
      const h = await authHeaders();

      const result = await poll(
        async () => {
          const res = await httpPatch<{ id: string }>(
            `${GW}/registry/services/${serviceId}`,
            { maxScale: 2 },
            { headers: h },
          );
          if (res.status === 200) return res;
          return null;
        },
        { timeoutMs: 15_000, initialDelayMs: 2_000, maxDelayMs: 3_000 },
      );

      expect(result.status).toBe(200);
      expect(result.body.id).toBe(serviceId);
    }, 20_000);
  });

  describe('revisions', () => {
    it('should list revisions', async () => {
      if (!serviceId) return;
      const h = await authHeaders();
      const { status, body } = await httpGet<unknown[]>(
        `${GW}/registry/services/${serviceId}/revisions`,
        { headers: h },
      );

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('routes', () => {
    let routeId: string;

    it('should create a route', async () => {
      if (!serviceId) return;
      const h = await authHeaders();
      const { status, body } = await httpPost<{ id: string; pathPrefix: string }>(
        `${GW}/registry/services/${serviceId}/routes`,
        { pathPrefix: '/e2e-route', methods: ['GET', 'POST'] },
        { headers: h },
      );

      expect(status).toBe(201);
      expect(body.id).toBeDefined();
      routeId = body.id;
      createdRouteIds.push({ serviceId, routeId });
    });

    it('should list service routes', async () => {
      if (!serviceId) return;
      const h = await authHeaders();
      const { status, body } = await httpGet<unknown[]>(
        `${GW}/registry/services/${serviceId}/routes`,
        { headers: h },
      );

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should discover all routes', async () => {
      const h = await authHeaders();
      const { status, body } = await httpGet<unknown[]>(`${GW}/registry/routes`, {
        headers: h,
      });

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should delete a route', async () => {
      if (!serviceId || !routeId) return;
      const h = await authHeaders();
      const { status } = await httpDelete(
        `${GW}/registry/services/${serviceId}/routes/${routeId}`,
        { headers: h },
      );

      expect(status).toBe(204);
      const idx = createdRouteIds.findIndex((r) => r.routeId === routeId);
      if (idx >= 0) createdRouteIds.splice(idx, 1);
    });
  });

  describe('canary deployments', () => {
    let canaryStarted = false;

    it('should wait for Knative service to be ready, then start canary', async () => {
      if (!serviceId) return;
      const h = await authHeaders();

      await poll(
        async () => {
          const res = await httpGet<unknown[]>(
            `${GW}/registry/services/${serviceId}/revisions`,
            { headers: h },
          );
          if (res.status === 200 && Array.isArray(res.body) && res.body.length > 0) return true;
          return null;
        },
        { timeoutMs: 60_000, initialDelayMs: 2_000, maxDelayMs: 5_000 },
      );

      const result = await poll(
        async () => {
          const res = await httpPost<{ percent: number }>(
            `${GW}/registry/services/${serviceId}/canary`,
            { image: 'gcr.io/knative-samples/helloworld-go:v2', percent: 10 },
            { headers: h },
          );
          if (res.status === 201) return res;
          return null;
        },
        { timeoutMs: 30_000, initialDelayMs: 3_000, maxDelayMs: 5_000 },
      );

      expect(result.status).toBe(201);
      expect(result.body).toBeDefined();
      canaryStarted = true;
    }, 120_000);

    it('should get canary status', async () => {
      if (!serviceId || !canaryStarted) return;
      const h = await authHeaders();
      const { status, body } = await httpGet<{ percent: number }>(
        `${GW}/registry/services/${serviceId}/canary`,
        { headers: h },
      );

      expect(status).toBe(200);
      expect(body).toBeDefined();
    });

    it('should update canary percent', async () => {
      if (!serviceId || !canaryStarted) return;
      const h = await authHeaders();

      const result = await poll(
        async () => {
          const res = await httpPatch(
            `${GW}/registry/services/${serviceId}/canary`,
            { percent: 50 },
            { headers: h },
          );
          if (res.status === 200) return res;
          return null;
        },
        { timeoutMs: 15_000, initialDelayMs: 2_000, maxDelayMs: 3_000 },
      );

      expect(result.status).toBe(200);
    }, 20_000);

    it('should promote canary', async () => {
      if (!serviceId || !canaryStarted) return;
      const h = await authHeaders();

      const result = await poll(
        async () => {
          const res = await httpPost(
            `${GW}/registry/services/${serviceId}/canary/promote`,
            {},
            { headers: h },
          );
          if (res.status === 201 || res.status === 200) return res;
          return null;
        },
        { timeoutMs: 15_000, initialDelayMs: 2_000, maxDelayMs: 3_000 },
      );

      expect(result.status === 200 || result.status === 201).toBe(true);
    }, 20_000);
  });

  describe('cleanup', () => {
    it('should remove the registered service', async () => {
      if (!serviceId) return;
      const h = await authHeaders();
      const { status } = await httpDelete(`${GW}/registry/services/${serviceId}`, {
        headers: h,
      });

      expect(status).toBe(204);
      createdServiceIds.splice(createdServiceIds.indexOf(serviceId), 1);
    });
  });
});
